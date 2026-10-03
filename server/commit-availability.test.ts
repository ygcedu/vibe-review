import assert from "node:assert/strict";
import { test } from "node:test";
import { isLatestReviewTurn } from "./commit-availability.ts";

const user = (turnId: string) => ({ turnId, item: { type: "user_message" } });
const review = (turnId: string, scoredAt: string) => ({ item: { type: "plugin", kind: "review-result", data: { turnId, scoredAt } } });

test("Pi entry belongs only to the latest reviewed user turn", () => {
  const first = "2026-10-03T10:00:00Z";
  const second = "2026-10-03T11:00:00Z";
  assert.equal(isLatestReviewTurn([user("turn-1"), review("turn-1", first)], first), true);
  assert.equal(isLatestReviewTurn([user("turn-1"), review("turn-1", first), user("turn-2")], first), false);
  assert.equal(isLatestReviewTurn([user("turn-1"), review("turn-1", first), user("turn-2"), review("turn-2", second)], first), false);
  assert.equal(isLatestReviewTurn([user("turn-1"), review("turn-1", first), user("turn-2"), review("turn-2", second)], second), true);
  assert.equal(isLatestReviewTurn([user("turn-1"), user("turn-2"), review("turn-1", first)], first), false);
});
