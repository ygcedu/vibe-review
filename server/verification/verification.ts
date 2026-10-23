import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { pluginData } from "../../shared/timeline.ts";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "../paseo-api-types.ts";
import { reviewResultSchema, REVIEW_KIND, REVIEW_VERSION } from "../../shared/review.ts";
import type { output } from "zod";
import { appendReviewWithRetry } from "../review/review-append.ts";
import { recoverFinishedVerification, VERIFIER_LABEL, VERIFIER_TITLE } from "./verify.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resultAfterVerification, verdictOf } from "../review/verdict.ts";
import type { VerificationControl, VerificationRequest, VerificationResult } from "./verify.ts";

export type ReviewCardData = output<typeof reviewResultSchema>;
type ActiveVerification = { cardId: string; card: ReviewCardData; writeQueue: Promise<unknown> };
type VerificationRunner = { verifyTask(agentId: string, request: VerificationRequest, control?: VerificationControl): Promise<VerificationResult> };
const activeVerifications = new Map<string, ActiveVerification>();
const verificationKey = (agentId: string, scoredAt: string) => `${agentId}:${scoredAt}`;
const execFileAsync = promisify(execFile);
const isCanceled = (active: ActiveVerification) => active.card.verificationState === "canceled";

/** Select the same review card for navigation, recovery and cancellation. */
function findReviewCard(entries: readonly { item: AgentTimelineItem }[], scoredAt: string) {
  for (const { item } of entries) {
    if (item.type === "plugin" && item.kind === REVIEW_KIND && pluginData(item, REVIEW_KIND)?.scoredAt === scoredAt) return item;
  }
}

/** Resolve the verifier bound to one card, reviving its archived Paseo session. */
export async function openVerification(paseo: PluginHandlerContext["paseo"], agentId: string, scoredAt: string): Promise<{ verifierAgentId: string; workspaceId: string }> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ limit: 200 });
  const item = findReviewCard(page.entries, scoredAt);
  const parsed = item ? reviewResultSchema.safeParse(item.data) : null;
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

function completeCard(card: ReviewCardData, verification: VerificationResult): ReviewCardData {
  const result = resultAfterVerification(card.result, verification.status) ?? "unknown";
  const { verdict, completed } = verdictOf({ result, drifts: card.drifts ?? [] });
  return { ...card, verdict, completed, result, verification,
    verificationState: "complete", verificationStage: undefined };
}

function sessionFor(cardId: string, card: ReviewCardData): ActiveVerification {
  return { cardId, card, writeQueue: Promise.resolve() };
}

/** Every writer, including recovery and cancellation, uses this card's queue. */
function writeCard(paseo: PaseoApi, agentId: string, active: ActiveVerification, data: ReviewCardData, replace = true) {
  const write = active.writeQueue.catch(() => undefined).then(() => {
    if (data.verificationState !== "canceled" && isCanceled(active)) return null;
    return appendReviewWithRetry(paseo, agentId, {
      type: "plugin", id: active.cardId, kind: REVIEW_KIND, version: REVIEW_VERSION, data,
    }, replace);
  });
  active.writeQueue = write;
  return write;
}

async function releaseSession(key: string, active: ActiveVerification) {
  // Cancellation may enqueue another write while the previous one settles.
  let pending: Promise<unknown>;
  do {
    pending = active.writeQueue;
    await pending.catch(() => undefined);
  } while (pending !== active.writeQueue);
  if (activeVerifications.get(key) === active) activeVerifications.delete(key);
}

/** Own publication and verification together; callers never manipulate runtime state. */
export async function publishReviewCard(paseo: PaseoApi, agentId: string, cardId: string, card: ReviewCardData, run: VerificationRunner, replace = false): Promise<ReviewCardData | null> {
  const key = verificationKey(agentId, card.scoredAt);
  if (activeVerifications.has(key)) return null;
  const active = sessionFor(cardId, card);
  if (card.verificationState === "running") activeVerifications.set(key, active);
  try {
    const appended = await writeCard(paseo, agentId, active, card, replace);
    if (isCanceled(active)) return null;
    console.log(`[vibe-review] appended review: verdict=${card.verdict} completed=${card.completed} drift=${card.drift} followups=${card.followups?.length ?? 0} seq=${appended?.seq ?? "already-present"}`);
    if (card.verificationState !== "running") return card;
    let verification: VerificationResult;
    try {
      verification = await run.verifyTask(agentId, { goal: card.goal ?? card.summary, narrative: card.narrative ?? "" }, {
        isCanceled: () => isCanceled(active),
        onAgentCreated: async (verifierAgentId) => {
          if (active.card.verificationState !== "running") {
            archiveVerifier(paseo, verifierAgentId);
            return;
          }
          active.card = { ...active.card, verificationAgentId: verifierAgentId, verificationStage: "正在选择验证方式…" };
          await writeCard(paseo, agentId, active, active.card);
        },
        onProgress: (stage) => {
          if (active.card.verificationState !== "running" || active.card.verificationStage === stage) return;
          active.card = { ...active.card, verificationStage: stage };
          void writeCard(paseo, agentId, active, active.card).catch((error) =>
            console.warn("[vibe-review] verification progress update failed:", error));
        },
      });
    } catch (error) {
      console.error("[vibe-review] independent verification failed:", error);
      verification = { status: "unavailable", summary: error instanceof Error ? error.message : "验证任务无法运行。", evidence: [], provider: "" };
    }
    if (isCanceled(active)) return null;
    active.card = completeCard(active.card, verification);
    await writeCard(paseo, agentId, active, active.card);
    return active.card;
  } catch (error) {
    console.error("[vibe-review] review card update failed:", error);
    return null;
  } finally {
    await releaseSession(key, active);
  }
}

/** Restore a card whose verifier outlived the plugin process that created it. */
export async function reconcileVerification(paseo: PluginHandlerContext["paseo"], agentId: string, scoredAt: string): Promise<void> {
  const key = verificationKey(agentId, scoredAt);
  if (activeVerifications.has(key)) return;
  const findCard = async () => findReviewCard((await paseo.agents.ref(agentId).timeline.refetch({ limit: 200 })).entries, scoredAt);
  const item = await findCard();
  const parsed = item ? reviewResultSchema.safeParse(item.data) : null;
  if (!item || !parsed?.success || parsed.data.verificationState !== "running" || activeVerifications.has(key)) return;
  const active = sessionFor(item.id, parsed.data);
  activeVerifications.set(key, active);
  try {
    const card = active.card;
    const verification = card.verificationAgentId
      ? await recoverFinishedVerification(paseo, card.verificationAgentId)
      : Date.now() - Date.parse(scoredAt) > 6 * 60_000
        ? { status: "unavailable" as const, summary: "插件重载后无法找到原验证 agent，请重新发起验证。", evidence: [], provider: "" }
        : null;
    if (!verification || isCanceled(active)) return;
    const latest = await findCard();
    const latestParsed = latest ? reviewResultSchema.safeParse(latest.data) : null;
    if (!latestParsed?.success || latestParsed.data.verificationState !== "running" || isCanceled(active)) return;
    active.card = completeCard(latestParsed.data, verification);
    await writeCard(paseo, agentId, active, active.card);
  } finally {
    await releaseSession(key, active);
  }
}

function archiveVerifier(paseo: PaseoApi, verifierId: string) {
  void (async () => {
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

/** Cancel live and reloaded cards through the same serialized write path. */
export async function cancelVerification(paseo: PaseoApi, agentId: string, scoredAt: string): Promise<void> {
  const key = verificationKey(agentId, scoredAt);
  let active = activeVerifications.get(key);
  let owned = false;
  if (!active) {
    const ref = paseo.agents.ref(agentId);
    let page: Awaited<ReturnType<typeof ref.timeline.refetch>> | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { page = await ref.timeline.refetch(); break; }
      catch (error) {
        if (!/Transport (?:closed|not connected)|status: disconnected/i.test(String(error)) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    // A recovery may have reserved this card while refetch was in flight.
    active = activeVerifications.get(key);
    if (!active) {
      const item = findReviewCard(page?.entries ?? [], scoredAt);
      if (!item) throw new Error("审核卡片已失效，请刷新后重试。");
      const card = reviewResultSchema.safeParse(item.data);
      if (!card.success) throw new Error("审核卡片数据无效，请刷新后重试。");
      if (card.data.verificationState !== "running") throw new Error("验证已结束。");
      active = sessionFor(item.id, card.data);
      activeVerifications.set(key, active);
      owned = true;
    }
  }
  try {
    if (active.card.verificationState !== "running" && active.card.verificationState !== "canceled") throw new Error("验证已结束。");
    const verifierId = active.card.verificationAgentId;
    active.card = { ...active.card, verificationState: "canceled", verificationStage: undefined, verificationAgentId: undefined };
    if (verifierId) archiveVerifier(paseo, verifierId);
    // Repeating a failed cancellation retries its write instead of silently succeeding.
    await writeCard(paseo, agentId, active, active.card);
  } finally {
    if (owned) await releaseSession(key, active);
  }
}
