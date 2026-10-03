import { REVIEW_KIND } from "../shared/review.ts";
import { COMMIT_PREVIEW_KIND } from "../shared/commit.ts";

type TimelineEntry = {
  item: { type: string; kind?: string; data?: { scoredAt?: string; turnId?: string } };
  turnId?: string;
};

/** A review is eligible only while it describes the agent's latest user turn. */
export function isLatestReviewTurn(entries: readonly TimelineEntry[], scoredAt: string): boolean {
  const reviewIndex = entries.findLastIndex(({ item }) => item.type === "plugin" && item.kind === REVIEW_KIND);
  if (reviewIndex < 0 || entries[reviewIndex].item.data?.scoredAt !== scoredAt) return false;
  const userIndex = entries.findLastIndex(({ item }) => item.type === "user_message");
  if (userIndex > reviewIndex) return false;
  const reviewTurn = entries[reviewIndex].item.data?.turnId;
  const userTurn = userIndex >= 0 ? entries[userIndex].turnId : undefined;
  return !reviewTurn || !userTurn || reviewTurn === userTurn;
}

type CommitEntry = { type?: string; kind?: string; data?: { proposalId?: string } };

/** A commit preview is usable only until another user turn or preview begins. */
export function isCurrentCommitPreview(items: readonly CommitEntry[], proposalId: string): boolean {
  const previewIndex = items.findLastIndex((item) => item.type === "plugin" && item.kind === COMMIT_PREVIEW_KIND && item.data?.proposalId === proposalId);
  if (previewIndex < 0) return false;
  return !items.slice(previewIndex + 1).some((item) => item.type === "user_message" || (item.type === "plugin" && item.kind === COMMIT_PREVIEW_KIND));
}
