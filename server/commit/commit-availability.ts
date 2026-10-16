import { REVIEW_KIND } from "../../shared/review.ts";
import { COMMIT_PREVIEW_KIND, COMMIT_RESULT_KIND } from "../../shared/commit.ts";
import { pluginData, type TimelineItem } from "../../shared/timeline.ts";

type TimelineEntry = { item: TimelineItem; turnId?: string | null };

/** A review is eligible only while it describes the agent's latest user turn. */
export function isLatestReviewTurn(entries: readonly TimelineEntry[], scoredAt: string): boolean {
  const reviewIndex = entries.findLastIndex(({ item }) => item.type === "plugin" && item.kind === REVIEW_KIND);
  if (reviewIndex < 0) return false;
  const review = pluginData(entries[reviewIndex].item, REVIEW_KIND);
  if (review?.scoredAt !== scoredAt) return false;
  const userIndex = entries.findLastIndex(({ item }) => item.type === "user_message");
  if (userIndex > reviewIndex) return false;
  const userTurn = userIndex >= 0 ? entries[userIndex].turnId : undefined;
  return !review.turnId || !userTurn || review.turnId === userTurn;
}

/** A commit preview is usable only until another user turn or preview begins. */
export function isCurrentCommitPreview(items: readonly TimelineItem[], proposalId: string): boolean {
  const previewIndex = items.findLastIndex((item) => pluginData(item, COMMIT_PREVIEW_KIND)?.proposalId === proposalId);
  if (previewIndex < 0) return false;
  return !items.slice(previewIndex + 1).some((item) => item.type === "user_message" || (item.type === "plugin" && item.kind === COMMIT_PREVIEW_KIND));
}

/** Legacy results without a proposal id belong only to the immediately preceding preview. */
export function commitResultSummary(items: readonly TimelineItem[], proposalId: string): string | undefined {
  let result = items.map((item) => pluginData(item, COMMIT_RESULT_KIND)).findLast((data) => data?.proposalId === proposalId);
  if (!result) {
    const previewIndex = items.findIndex((item) => pluginData(item, COMMIT_PREVIEW_KIND)?.proposalId === proposalId);
    if (previewIndex < 0) return undefined;
    const next = items.slice(previewIndex + 1).find((item) => item.type === "plugin" && (item.kind === COMMIT_RESULT_KIND || item.kind === COMMIT_PREVIEW_KIND));
    const legacy = next && pluginData(next, COMMIT_RESULT_KIND);
    if (legacy && !legacy.proposalId) result = legacy;
  }
  if (typeof result?.summary !== "string" || !result.summary) return undefined;
  return result.ok ? `已提交：${result.summary}` : result.summary;
}
