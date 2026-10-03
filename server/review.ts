import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "./paseo-api-types";
import { buildTaskSummary, isSessionControlCommand } from "./inspect";
import { notify } from "./notify";
import { distillTask, type DistilledTask } from "./distill";
import type { LlmConfig } from "../shared/settings";
import { REVIEW_KIND, REVIEW_VERSION } from "../shared/review";
import type { VerificationRequest, VerificationResult } from "./verify";
import { appendReviewWithRetry } from "./review-append";

/** Settings access, injected from the server entry point. */
export interface RunContext {
  getLlmConfig(): Promise<LlmConfig>;
  verifyTask(agentId: string, request: VerificationRequest): Promise<VerificationResult>;
}

/** Auto follow-up only for spawned task agents (labeled by Paseo), never the user's main session. */
const SPAWNED_LABEL = "paseo.parent-agent-id";
const FOLLOWUP_COOLDOWN_MS = 10 * 60 * 1000;

const lastFollowupAt = new Map<string, number>();

export interface ReviewResult {
  verdict: "pass" | "review" | "reject";
  completed: number;
  drift: "in_scope" | "minor_drift" | "major_drift";
  summary: string;
  scoredAt: string;
}

/** 大模型的 result 词映射成 completed 分数（完成度全由 LLM 判断）。 */
const RESULT_SCORE: Record<DistilledTask["result"], number> = {
  done: 1,
  partial: 0.5,
  none: 0,
  unknown: 0.5,
};

export function verdictOf(
  distilled: { drifts: string[]; result: DistilledTask["result"] },
): { verdict: ReviewResult["verdict"]; completed: number; drift: "in_scope" | "minor_drift" | "major_drift" } {
  const completed = RESULT_SCORE[distilled.result];
  const drift: "in_scope" | "minor_drift" | "major_drift" =
    distilled.drifts.length >= 2 ? "major_drift" : distilled.drifts.length === 1 ? "minor_drift" : "in_scope";

  let verdict: ReviewResult["verdict"];
  if (drift === "major_drift" || distilled.result === "none") verdict = "reject";
  else if (drift === "minor_drift" || distilled.result !== "done") verdict = "review";
  else verdict = "pass";
  return { verdict, completed, drift };
}

/**
 * Set-and-forget review for a finished turn. Must never throw or block the
 * turn-end hook (Paseo's 30s RPC timeout would mark the hook failed); all errors
 * are logged inside. The card carries the turnId it belongs to, so a late append
 * doesn't read as the *current* turn's verdict.
 */
export type TurnOutcome = { kind: string; error?: { message?: string } };
export type FileChanges = { diff: string; diffIncomplete: boolean };

export function queueReview(
  paseo: PaseoApi,
  agentId: string,
  timeline: readonly AgentTimelineItem[],
  turnId: string | null,
  labels: Record<string, string> | undefined,
  run: RunContext,
  outcome?: TurnOutcome,
  fileChanges?: FileChanges,
): void {
  void (async () => {
    try {
      await runReview(paseo, agentId, timeline, turnId, labels, run, outcome, fileChanges);
    } catch (error) {
      console.error("[vibe-review] review crashed:", error);
    }
  })();
}

/** Manual trigger from the command center: blocks until the card is appended. */
export async function reviewAgent(agentId: string, context: { paseo: PaseoApi }, run: RunContext): Promise<void> {
  const ref = context.paseo.agents.ref(agentId);
  const payload = await ref.timeline.refetch();
  const items = (payload as unknown as { entries?: Array<{ item: unknown }> }).entries ?? [];
  const timeline = items.map((entry) => entry.item) as unknown as AgentTimelineItem[];
  const agent = ref.current() as { labels?: Record<string, string> } | null;
  await runReview(context.paseo, agentId, timeline, null, agent?.labels, run);
}

async function runReview(
  paseo: PaseoApi,
  agentId: string,
  timeline: readonly AgentTimelineItem[],
  turnId: string | null,
  labels: Record<string, string> | undefined,
  run: RunContext,
  outcome?: TurnOutcome,
  fileChanges?: FileChanges,
): Promise<void> {
  const summary = buildTaskSummary(timeline);
  // A review started after plugin reload or from the command center has no turn-start baseline.
  // Never present a series of tool edits as if it were the final file diff.
  const lastTurnDiff = fileChanges?.diff;
  const diffIncomplete = fileChanges?.diffIncomplete ?? true;
  // Nothing was actually done — skip review.
  if (!summary.task && summary.userMessages.length === 0) return;
  if (isSessionControlCommand(summary.task)) return;

  let distilled: DistilledTask;
  try {
    const config = await run.getLlmConfig();
    distilled = await distillTask(
      config,
      summary.userMessages,
      summary.assistantMessages,
      {
        lastTurnDiff,
        diffIncomplete,
        runningTools: summary.runningTools,
        turnOutcome: outcome,
      },
    );
  } catch (error) {
    console.error("[vibe-review] LLM distill failed, falling back to raw task:", error);
    distilled = { goal: summary.task.slice(0, 80) || "完成用户任务", drifts: [], narrative: "", result: "unknown", taskType: "other", followups: ["请确认本轮任务是否已经完成；如有遗漏，请继续处理并说明结果。"], promptNoDiff: "" };
  }

  // 中断信号（工具卡 running / turn failed / canceled）是确定的事实，不靠 LLM 猜；
  // LLM 说 unknown 时也不覆盖已知的中断，直接判 none。
  const interrupted = summary.runningTools > 0 || outcome?.kind === "failed" || outcome?.kind === "canceled";
  if (interrupted && (distilled.result === "unknown" || distilled.result === "done")) {
    distilled.result = "none";
  }

  // The classifier can mistake a code-changing turn for a simple reply. A
  // measured workspace diff is definitive evidence that the turn needs a card.
  if (distilled.taskType === "simple_reply" && lastTurnDiff?.trim()) {
    console.warn("[vibe-review] overriding simple_reply because files changed:", agentId, turnId);
    distilled.taskType = "other";
  }

  if (distilled.taskType === "simple_reply" && !interrupted) {
    console.log("[vibe-review] simple reply; no review or verification needed:", agentId, turnId);
    return;
  }

  let verification: VerificationResult | undefined;
  if (distilled.taskType === "verification_required" && !interrupted) {
    try {
      verification = await run.verifyTask(agentId, {
        goal: distilled.goal,
        narrative: distilled.narrative,
        assistantMessages: summary.assistantMessages,
        diff: lastTurnDiff,
      });
    } catch (error) {
      console.error("[vibe-review] independent verification failed:", error);
      verification = { status: "unavailable", summary: error instanceof Error ? error.message.slice(0, 300) : "验证任务无法运行。", evidence: [], provider: "" };
    }
    if (distilled.result === "done" && verification.status === "failed") distilled.result = "partial";
    if (distilled.result === "done" && verification.status === "unavailable") distilled.result = "unknown";
  }

  const { verdict, completed, drift } = verdictOf(distilled);
  const result: ReviewResult = {
    verdict,
    completed,
    drift,
    summary: distilled.goal || summary.task,
    scoredAt: new Date().toISOString(),
  };

  try {
    const appendResult = await appendReviewWithRetry(paseo, agentId, {
      type: "plugin",
      id: `vibe-review-${turnId ?? Date.now()}`,
      kind: REVIEW_KIND,
      version: REVIEW_VERSION,
      data: {
        verdict: result.verdict,
        completed: result.completed,
        drift: result.drift,
        summary: result.summary,
        scoredAt: result.scoredAt,
        turnId: turnId ?? undefined,
        goal: distilled.goal,
        result: distilled.result,
        taskType: distilled.taskType,
        verification,
        drifts: distilled.drifts,
        narrative: distilled.narrative,
        followups: distilled.followups,
        diff: lastTurnDiff || undefined,
        diffIncomplete,
        detail: distilled.promptNoDiff,
      },
    });
    console.log(
      `[vibe-review] appended review: verdict=${result.verdict} completed=${result.completed} drift=${result.drift} followups=${distilled.followups.length} seq=${appendResult?.seq ?? "already-present"}`,
    );
  } catch (error) {
    console.error("[vibe-review] timeline append failed:", error);
  }

  if (result.verdict === "pass") return;

  // Agent 2 (notify): reject/review always notify the user.
  const taskTitle = summary.task.slice(0, 40);
  if (result.verdict === "reject") {
    void notify("审核：偏离目标", taskTitle ? `${taskTitle}…` : "任务明显偏离目标，需人工介入");
  } else {
    void notify("审核：需复核", taskTitle ? `${taskTitle}…` : "任务可能需要复核");
  }

  // Agent 1 (auto follow-up): only for spawned task agents, with cooldown.
  if (!isSpawnedAgent(labels)) {
    console.log(`[vibe-review] ${result.verdict} but agent is a main session; notifying only`);
    return;
  }
  const last = lastFollowupAt.get(agentId) ?? 0;
  if (Date.now() - last < FOLLOWUP_COOLDOWN_MS) return;
  lastFollowupAt.set(agentId, Date.now());

  const message =
    result.verdict === "reject"
      ? "审核判定：代码变更明显偏离原始任务目标。请回滚与任务无关的修改，聚焦原始目标，完成后重新自检。"
      : "审核判定：任务可能未完整完成或执行中出现异常。请自检：对照原始任务逐条确认交付物是否齐全、是否存在未修复的报错。";

  try {
    await paseo.agents.ref(agentId).send(message);
    console.log(`[vibe-review] sent follow-up (${result.verdict}) to ${agentId}`);
  } catch (error) {
    console.error("[vibe-review] follow-up send failed:", error);
  }
}

/** Spawned task agents carry a `paseo.parent-agent-id` label; user's main session does not. */
function isSpawnedAgent(labels?: Record<string, string>): boolean {
  return Boolean(labels && labels[SPAWNED_LABEL]);
}
