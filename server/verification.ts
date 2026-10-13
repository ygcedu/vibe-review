import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "./paseo-api-types.ts";
import { reviewResultSchema, REVIEW_KIND, REVIEW_VERSION } from "../shared/review.ts";
import type { output } from "zod";
import { appendReviewWithRetry } from "./review-append.ts";
import { recoverFinishedVerification, VERIFIER_LABEL, VERIFIER_TITLE } from "./verify.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verdictOf } from "./verdict.ts";
import type { VerificationControl, VerificationRequest, VerificationResult } from "./verify.ts";

export type ReviewCardData = output<typeof reviewResultSchema>;
export type ActiveVerification = { canceled: boolean; verifierAgentId?: string; cardId: string; card: ReviewCardData; writeQueue: Promise<unknown> };
export const activeVerifications = new Map<string, ActiveVerification>();
export const reconcilingVerifications = new Set<string>();
export const verificationKey = (agentId: string, scoredAt: string) => `${agentId}:${scoredAt}`;
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

export function queueVerificationCardWrite(paseo: PaseoApi, agentId: string, cardId: string, active: ActiveVerification, data: ReviewCardData, skipIfCanceled = true): Promise<unknown> {
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

/** Run independent verification for a card and update it to completion. */
export async function runVerificationAndWrite(
  paseo: PaseoApi,
  agentId: string,
  cardId: string,
  card: ReviewCardData,
  key: string,
  active: ActiveVerification,
  run: { verifyTask(agentId: string, request: VerificationRequest, control?: VerificationControl): Promise<VerificationResult> },
  distilled: import("./distill.ts").DistilledTask,
  assistantMessages: string[],
  lastTurnDiff: string | undefined,
): Promise<import("./verdict.ts").ReviewResult | null> {
  let verification: VerificationResult;
  try {
    verification = await run.verifyTask(agentId, {
      goal: distilled.goal,
      narrative: distilled.narrative,
      assistantMessages,
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
    if (active.canceled) return null;
    if (distilled.result === "done" && verification.status === "failed") distilled.result = "partial";
    if (distilled.result === "done" && verification.status === "unavailable") distilled.result = "unknown";
    const finalVerdict = verdictOf(distilled);
    await queueVerificationCardWrite(paseo, agentId, cardId, active, {
      ...card, verdict: finalVerdict.verdict, completed: finalVerdict.completed,
      result: distilled.result, verificationState: "complete", verificationStage: undefined, verificationAgentId: active.verifierAgentId,
      verification, followups: distilled.followups,
    });
    return { verdict: finalVerdict.verdict, completed: finalVerdict.completed, drift: card.drift, summary: card.summary, scoredAt: card.scoredAt } as import("./verdict.ts").ReviewResult;
  } catch (error) {
    console.error("[vibe-review] verification card update failed:", error);
  } finally {
    activeVerifications.delete(key);
  }
  return null;
}
