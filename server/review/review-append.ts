import type { PaseoApi } from "../paseo-api-types.ts";
import { REVIEW_KIND } from "../../shared/review.ts";

const MAX_CARD_BYTES = 65536;

/** Full-context diffs can dwarf the actual edits. Keep review/verification data
 * publishable without changing the full input used by the review model. */
export function fitReviewItem(item: AppendableReviewItem): AppendableReviewItem {
  if (item.kind !== REVIEW_KIND || Buffer.byteLength(JSON.stringify(item.data), "utf8") <= MAX_CARD_BYTES) return item;
  const data = { ...(item.data as Record<string, unknown>) };
  const fits = () => Buffer.byteLength(JSON.stringify(data), "utf8") <= MAX_CARD_BYTES;
  delete data.fullDiff;
  if (!fits()) {
    delete data.diff;
    data.diffIncomplete = true;
  }
  if (!fits()) delete data.detail;
  // Bound unusually long model output too, including nested verification evidence.
  const shorten = (value: unknown, limit: number): unknown => {
    if (typeof value === "string") return value.length > limit ? `${value.slice(0, limit)}…` : value;
    if (Array.isArray(value)) return value.map((entry) => shorten(entry, limit));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shorten(entry, limit)]));
    return value;
  };
  let bounded: unknown = data;
  for (let limit = 8192; Buffer.byteLength(JSON.stringify(bounded), "utf8") > MAX_CARD_BYTES && limit >= 128; limit /= 2) {
    bounded = shorten(data, limit);
  }
  if (Buffer.byteLength(JSON.stringify(bounded), "utf8") > MAX_CARD_BYTES) {
    throw new Error("Review metadata exceeds the timeline limit even after removing large attachments");
  }
  console.warn("[vibe-review] reduced oversized review card:", item.id);
  return { ...item, data: bounded };
}

export interface AppendableReviewItem {
  type: "plugin";
  id: string;
  kind: string;
  version: number;
  data: unknown;
}

function connectionLost(error: unknown): boolean {
  const value = error as { code?: string; message?: string };
  return value?.code === "DAEMON_CONNECTION_LOST" || /Transport (?:closed|not connected)|status: disconnected/i.test(value?.message ?? "");
}

/** A plugin session can reconnect during a long verification; retry only transport failures. */
export async function appendReviewWithRetry(paseo: PaseoApi, agentId: string, item: AppendableReviewItem, replace = false): Promise<{ seq: number; epoch: string } | null> {
  item = fitReviewItem(item);
  const agent = paseo.agents.ref(agentId);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0 && !replace) {
        const page = await agent.timeline.refetch();
        if (page.entries?.some(({ item: existing }) => existing.type === "plugin" && existing.id === item.id)) return null;
      }
      return await agent.timeline.append(item);
    } catch (error) {
      if (!connectionLost(error) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return null;
}
