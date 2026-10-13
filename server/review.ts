import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "./paseo-api-types";
import { buildTaskSummary, isSessionControlCommand } from "./inspect.ts";
import { notify } from "./notify.ts";
import { distillTask, type DistilledTask } from "./distill.ts";
import type { LlmConfig } from "../shared/settings";
import { reviewResultSchema, REVIEW_KIND, REVIEW_VERSION } from "../shared/review.ts";
import type { output } from "zod";
import type { VerificationControl, VerificationRequest, VerificationResult } from "./verify";
import { appendReviewWithRetry } from "./review-append.ts";
import { recoverFinishedVerification, VERIFIER_LABEL, VERIFIER_TITLE } from "./verify.ts";
import { isNoDrift } from "../shared/drift.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Settings access, injected from the server entry point. */
export interface RunContext {
  getLlmConfig(): Promise<LlmConfig>;
  verifyTask(agentId: string, request: VerificationRequest, control?: VerificationControl): Promise<VerificationResult>;
}

type ReviewCardData = output<typeof reviewResultSchema>;
type ActiveVerification = { canceled: boolean; verifierAgentId?: string; cardId: string; card: ReviewCardData; writeQueue: Promise<unknown> };
const activeVerifications = new Map<string, ActiveVerification>();
const reconcilingVerifications = new Set<string>();
const verificationKey = (agentId: string, scoredAt: string) => `${agentId}:${scoredAt}`;
const execFileAsync = promisify(execFile);

/** Resolve the verifier bound to one card, reviving its archived Paseo session. */
export async function openVerification(paseo: PluginHandlerContext["paseo"], agentId: string, scoredAt: string): Promise<{ verifierAgentId: string; workspaceId: string }> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ limit: 200 });
  const item = page.entries.find(({ item }: { item: AgentTimelineItem }) => item.type === "plugin" && item.kind === REVIEW_KIND &&
    (item.data as { scoredAt?: string }).scoredAt === scoredAt)?.item;
  const parsed = item?.type === "plugin" ? reviewResultSchema.safeParse(item.data) : null;
  const verifierAgentId = parsed?.success ? parsed.data.verificationAgentId : undefined;
  if (!verifierAgentId) throw new Error("这张卡没有保存验证 agent，无法跳转。");

  const verifier = paseo.agents.ref(verifierAgentId);
  let snapshot = (await verifier.refresh())?.agent;
  if (!snapshot || snapshot.id !== verifierAgentId || (snapshot.labels?.[VERIFIER_LABEL] !== "true" && snapshot.title !== VERIFIER_TITLE)) {
    throw new Error("无法确认这张卡对应的验证 agent。");
  }
  if (snapshot.archivedAt) {
    await execFileAsync("paseo", ["agent", "reload", verifierAgentId, "--json"], { timeout: 30_000 });
    snapshot = (await verifier.refresh())?.agent;
  }
  if (!snapshot || snapshot.id !== verifierAgentId || snapshot.archivedAt || !snapshot.workspaceId) {
    throw new Error("验证 agent 尚未恢复，请稍后重试。");
  }
  return { verifierAgentId, workspaceId: snapshot.workspaceId };
}

/** Restore a card whose verifier outlived the plugin process that created it. */
export async function reconcileVerification(paseo: PluginHandlerContext["paseo"], agentId: string, scoredAt: string): Promise<void> {
  const key = verificationKey(agentId, scoredAt);
  if (activeVerifications.has(key) || reconcilingVerifications.has(key)) return;
  reconcilingVerifications.add(key);
  try {
    const parent = paseo.agents.ref(agentId);
    const findCard = async () => {
      const page = await parent.timeline.refetch({ limit: 200 });
      const item = page.entries.find(({ item }: { item: AgentTimelineItem }) => item.type === "plugin" && item.kind === REVIEW_KIND &&
        (item.data as { scoredAt?: string }).scoredAt === scoredAt)?.item;
      return item?.type === "plugin" ? item : undefined;
    };
    const item = await findCard();
    if (!item) return;
    const parsed = reviewResultSchema.safeParse(item.data);
    if (!parsed.success || parsed.data.verificationState !== "running") return;
    const card = parsed.data;
    const verification = card.verificationAgentId
      ? await recoverFinishedVerification(paseo, card.verificationAgentId)
      : Date.now() - Date.parse(scoredAt) > 6 * 60_000
        ? { status: "unavailable" as const, summary: "插件重载后无法找到原验证 agent，请重新发起验证。", evidence: [], provider: "" }
        : null;
    if (!verification) return;
    if (activeVerifications.has(key)) return;
    const latest = await findCard();
    const latestParsed = latest?.type === "plugin" ? reviewResultSchema.safeParse(latest.data) : null;
    if (!latestParsed?.success || latestParsed.data.verificationState !== "running") return;
    const result = card.result === "done" && verification.status === "failed" ? "partial"
      : card.result === "done" && verification.status === "unavailable" ? "unknown" : card.result;
    const finalVerdict = verdictOf({ result: result ?? "unknown", drifts: card.drifts ?? [] });
    await appendReviewWithRetry(paseo, agentId, {
      type: "plugin", id: item.id, kind: REVIEW_KIND, version: REVIEW_VERSION,
      data: { ...card, verdict: finalVerdict.verdict, completed: finalVerdict.completed, result,
        verificationState: "complete", verificationStage: undefined, verificationAgentId: card.verificationAgentId, verification },
    }, true);
  } finally {
    reconcilingVerifications.delete(key);
  }
}

function queueVerificationCardWrite(paseo: PaseoApi, agentId: string, cardId: string, active: ActiveVerification, data: ReviewCardData, skipIfCanceled = true): Promise<unknown> {
  const write = active.writeQueue.catch(() => undefined).then(() => {
    if (skipIfCanceled && active.canceled) return null;
    return appendReviewWithRetry(paseo, agentId, {
      type: "plugin", id: cardId, kind: REVIEW_KIND, version: REVIEW_VERSION, data,
    }, true);
  });
  active.writeQueue = write;
  return write;
}

/** Cancel only the verification attached to this card, including after plugin reload. */
export async function cancelVerification(paseo: PaseoApi, agentId: string, scoredAt: string): Promise<void> {
  const key = verificationKey(agentId, scoredAt);
  const live = activeVerifications.get(key);
  if (live?.canceled) return;
  if (live) live.canceled = true;
  let cardId = live?.cardId;
  let cardData: unknown = live?.card;
  if (!live) {
    const ref = paseo.agents.ref(agentId);
    let page: Awaited<ReturnType<typeof ref.timeline.refetch>> | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { page = await ref.timeline.refetch(); break; }
      catch (error) {
        if (!/Transport (?:closed|not connected)|status: disconnected/i.test(String(error)) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    const item = page?.entries?.map(({ item }) => item).find((entry) => entry.type === "plugin" && entry.kind === REVIEW_KIND &&
      (entry.data as { scoredAt?: string }).scoredAt === scoredAt);
    if (!item || item.type !== "plugin") throw new Error("审核卡片已失效，请刷新后重试。");
    cardId = item.id;
    cardData = item.data;
  }
  const card = reviewResultSchema.safeParse(cardData);
  if (!card.success) {
    if (live) live.canceled = false;
    throw new Error("审核卡片数据无效，请刷新后重试。");
  }
  if (card.data.verificationState !== "running") {
    if (live) live.canceled = false;
    throw new Error("验证已结束。");
  }
  const canceledCard: ReviewCardData = { ...card.data, verificationState: "canceled", verificationStage: undefined, verificationAgentId: undefined, followups: live?.card.followups ?? card.data.followups };
  if (live) {
    live.card = canceledCard;
    await queueVerificationCardWrite(paseo, agentId, cardId!, live, canceledCard, false);
  }
  else await appendReviewWithRetry(paseo, agentId, {
    type: "plugin", id: cardId!, kind: REVIEW_KIND, version: REVIEW_VERSION, data: canceledCard,
  }, true);
  const verifierId = live?.verifierAgentId ?? card.data.verificationAgentId;
  if (verifierId) void (async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await paseo.agents.ref(verifierId).archive(); return; }
      catch (error) {
        if (attempt === 3 || !/Transport (?:closed|not connected)|status: disconnected/i.test(String(error))) {
          console.warn("[vibe-review] verifier archive after cancel failed:", error);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  })();
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
  const driftCount = distilled.drifts.filter((item) => !isNoDrift(item)).length;
  const drift: "in_scope" | "minor_drift" | "major_drift" =
    driftCount >= 2 ? "major_drift" : driftCount === 1 ? "minor_drift" : "in_scope";

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
    if (active.canceled) {
      activeVerifications.delete(key);
      return;
    }
    let verification: VerificationResult;
    try {
      verification = await run.verifyTask(agentId, {
        goal: distilled.goal,
        narrative: distilled.narrative,
        assistantMessages: summary.assistantMessages,
        diff: lastTurnDiff,
      }, {
        isCanceled: () => active.canceled,
        onAgentCreated: async (verifierAgentId) => {
          active.verifierAgentId = verifierAgentId;
          if (active.canceled) return;
          active.card = { ...active.card, verificationAgentId: verifierAgentId, verificationStage: "正在选择验证方式…" };
          await queueVerificationCardWrite(paseo, agentId, cardId, active, active.card);
        },
        onProgress: (stage) => {
          if (active.canceled || active.card.verificationStage === stage) return;
          active.card = { ...active.card, verificationStage: stage };
          void queueVerificationCardWrite(paseo, agentId, cardId, active, active.card).catch((error) =>
            console.warn("[vibe-review] verification progress update failed:", error));
        },
      });
    } catch (error) {
      console.error("[vibe-review] independent verification failed:", error);
      verification = { status: "unavailable", summary: error instanceof Error ? error.message : "验证任务无法运行。", evidence: [], provider: "" };
    }
    try {
      if (!active.canceled) {
        if (distilled.result === "done" && verification.status === "failed") distilled.result = "partial";
        if (distilled.result === "done" && verification.status === "unavailable") distilled.result = "unknown";
        const finalVerdict = verdictOf(distilled);
        await queueVerificationCardWrite(paseo, agentId, cardId, active, {
            ...card, verdict: finalVerdict.verdict, completed: finalVerdict.completed,
            result: distilled.result, verificationState: "complete", verificationStage: undefined, verificationAgentId: active.verifierAgentId,
            verification, followups: distilled.followups,
          });
        result.verdict = finalVerdict.verdict;
        result.completed = finalVerdict.completed;
      }
    } catch (error) {
      console.error("[vibe-review] verification card update failed:", error);
    } finally {
      activeVerifications.delete(key);
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
