import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "./paseo-api-types";
import { buildTaskSummary, type TaskSummary } from "./inspect";
import { notify } from "./notify";
import { distillTask, type DistilledTask } from "./distill";
import type { LlmConfig } from "../shared/settings";
import { reviewAgentRpc } from "../shared/review";

/** Settings access, injected from the server entry point. */
export interface RunContext {
  getLlmConfig(): Promise<LlmConfig>;
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

export function queueReview(
  paseo: PaseoApi,
  agentId: string,
  timeline: readonly AgentTimelineItem[],
  turnId: string | null,
  labels: Record<string, string> | undefined,
  run: RunContext,
  outcome?: TurnOutcome,
): void {
  void (async () => {
    try {
      await runReview(paseo, agentId, timeline, turnId, labels, run, outcome);
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
): Promise<void> {
  const summary = buildTaskSummary(timeline);
  // Nothing was actually done — skip review.
  if (!summary.task && summary.userMessages.length === 0) return;

  let distilled: DistilledTask;
  let config: LlmConfig;
  try {
    config = await run.getLlmConfig();
    distilled = await distillTask(
      config,
      summary.userMessages,
      summary.assistantMessages,
      summary.changedFiles,
      {
        lastTurnDiff: summary.lastTurnDiff,
        runningTools: summary.runningTools,
        turnOutcome: outcome,
      },
    );
  } catch (error) {
    console.error("[vibe-review] LLM distill failed, falling back to raw task:", error);
    distilled = { goal: summary.task.slice(0, 80) || "完成用户任务", drifts: [], narrative: "", result: "unknown", prompt: "", promptNoDiff: "" };
    config = { baseUrl: "", model: "", apiKey: "" };
  }

  // 中断信号（工具卡 running / turn failed / canceled）是确定的事实，不靠 LLM 猜；
  // LLM 说 unknown 时也不覆盖已知的中断，直接判 none。
  const interrupted = summary.runningTools > 0 || outcome?.kind === "failed" || outcome?.kind === "canceled";
  if (interrupted && (distilled.result === "unknown" || distilled.result === "done")) {
    distilled.result = "none";
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
    const appendResult = await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: `vibe-review-${turnId ?? Date.now()}`,
      kind: "review-result",
      version: 1,
      data: {
        verdict: result.verdict,
        completed: result.completed,
        drift: result.drift,
        summary: result.summary,
        scoredAt: result.scoredAt,
        turnId: turnId ?? undefined,
        goal: distilled.goal,
        result: distilled.result,
        drifts: distilled.drifts,
        narrative: distilled.narrative,
        changedFiles: summary.changedFiles,
        detail: distilled.promptNoDiff,
      },
    });
    console.log(
      `[vibe-review] appended review: verdict=${result.verdict} completed=${result.completed} drift=${result.drift} seq=${appendResult.seq}`,
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
