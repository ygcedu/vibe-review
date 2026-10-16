import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "../paseo-api-types.ts";
import { buildTaskSummary, isSessionControlCommand } from "./inspect.ts";
import { distillTask, type DistilledTask } from "./distill.ts";
import type { LlmConfig } from "../../shared/settings.ts";
import { REVIEW_KIND, REVIEW_VERSION } from "../../shared/review.ts";
import type { VerificationControl, VerificationRequest, VerificationResult } from "../verification/verify.ts";
import { appendReviewWithRetry } from "./review-append.ts";
import { notify } from "./notify.ts";
import { verdictOf, type ReviewResult } from "./verdict.ts";
import { maybeSendFollowup } from "./followup.ts";
import {
  activeVerifications,
  verificationKey,
  runVerificationAndWrite,
  type ActiveVerification,
  type ReviewCardData,
} from "../verification/verification.ts";

/** Settings access, injected from the server entry point. */
export interface RunContext {
  getLlmConfig(): Promise<LlmConfig>;
  verifyTask(agentId: string, request: VerificationRequest, control?: VerificationControl): Promise<VerificationResult>;
}

export type TurnOutcome = { kind: string; error?: { message?: string } };
export type FileChanges = { diff: string; fullDiff?: string; diffIncomplete: boolean };

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
  const timeline = (payload.entries ?? []).map(({ item }) => item);
  const agent = ref.current();
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
  const fullTurnDiff = fileChanges?.fullDiff;
  const diffIncomplete = fileChanges?.diffIncomplete ?? true;
  // Nothing was actually done — skip review.
  if (!summary.task && summary.userMessages.length === 0) return;
  if (isSessionControlCommand(summary.task)) return;

  const cardId = `vibe-review-${turnId ?? Date.now()}`;
  // Code-changing turns need an immediate marker while the model reviews them.
  // A later append with the same id replaces this row in place.
  if (turnId && lastTurnDiff?.trim()) {
    try {
      await appendReviewWithRetry(paseo, agentId, {
        type: "plugin", id: cardId, kind: REVIEW_KIND, version: REVIEW_VERSION,
        data: { verdict: "review", completed: 0, drift: "in_scope", summary: summary.task,
          goal: summary.task, scoredAt: new Date().toISOString(), turnId,
          processing: true, diff: lastTurnDiff, fullDiff: fullTurnDiff, diffIncomplete },
      });
    } catch (error) {
      console.warn("[vibe-review] pending review card unavailable:", error);
    }
  }

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
    distilled = { goal: summary.task || "完成用户任务", drifts: [], narrative: "", result: "unknown", taskType: "other", followups: ["请确认本轮任务是否已经完成；如有遗漏，请继续处理并说明结果。"], promptNoDiff: "" };
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

  const { verdict, completed, drift } = verdictOf(distilled);
  const result: ReviewResult = {
    verdict,
    completed,
    drift,
    summary: distilled.goal || summary.task,
    scoredAt: new Date().toISOString(),
  };

  const needsVerification = distilled.taskType === "verification_required" && !interrupted;
  const card: ReviewCardData = {
    verdict: result.verdict,
    completed: result.completed,
    drift: result.drift,
    summary: result.summary,
    scoredAt: result.scoredAt,
    turnId: turnId ?? undefined,
    goal: distilled.goal,
    result: distilled.result,
    taskType: distilled.taskType,
    verificationState: needsVerification ? "running" : undefined,
    verificationStage: needsVerification ? "正在启动独立验证…" : undefined,
    drifts: distilled.drifts,
    narrative: distilled.narrative,
    followups: distilled.followups,
    diff: lastTurnDiff || undefined,
    fullDiff: fullTurnDiff || undefined,
    diffIncomplete,
    detail: distilled.promptNoDiff,
  };
  const key = verificationKey(agentId, result.scoredAt);
  const active: ActiveVerification | undefined = needsVerification
    ? { canceled: false, cardId, card: { ...card, followups: distilled.followups }, writeQueue: Promise.resolve() }
    : undefined;
  if (active) activeVerifications.set(key, active);
  try {
    const appendResult = await appendReviewWithRetry(paseo, agentId, {
      type: "plugin",
      id: cardId,
      kind: REVIEW_KIND,
      version: REVIEW_VERSION,
      data: card,
    }, Boolean(turnId && lastTurnDiff?.trim()));
    console.log(
      `[vibe-review] appended review: verdict=${result.verdict} completed=${result.completed} drift=${result.drift} followups=${distilled.followups.length} seq=${appendResult?.seq ?? "already-present"}`,
    );
  } catch (error) {
    console.error("[vibe-review] timeline append failed:", error);
    if (active) activeVerifications.delete(key);
    return;
  }

  if (active) {
    const updated = await runVerificationAndWrite(
      paseo, agentId, cardId, card, key, active, run, distilled,
    );
    if (updated) {
      result.verdict = updated.verdict;
      result.completed = updated.completed;
    }
  }

  if (result.verdict === "pass") return;

  // Agent 2 (notify): reject/review always notify the user.
  const taskTitle = summary.task.length > 40 ? `${summary.task.slice(0, 40)}…` : summary.task;
  if (result.verdict === "reject") {
    void notify("审核：偏离目标", taskTitle || "任务明显偏离目标，需人工介入");
  } else {
    void notify("审核：需复核", taskTitle || "任务可能需要复核");
  }

  // Agent 1 (auto follow-up): only for spawned task agents, with cooldown.
  await maybeSendFollowup(paseo, agentId, labels, result.verdict === "reject" ? "reject" : "review");
}
