import { REVIEW_KIND } from "../shared/review.ts";

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
