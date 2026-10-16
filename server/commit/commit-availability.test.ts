import assert from "node:assert/strict";
import { test } from "node:test";
import { commitResultSummary, isCurrentCommitPreview, isLatestReviewTurn } from "./commit-availability.ts";

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

test("only the latest turn's commit preview remains visible", () => {
  const preview = (id: string) => ({ type: "plugin", kind: "pi-commit-preview", data: { proposalId: id } });
  assert.equal(isCurrentCommitPreview([preview("first")], "first"), true);
  assert.equal(isCurrentCommitPreview([preview("first"), { type: "user_message" }], "first"), false);
  assert.equal(isCurrentCommitPreview([preview("first"), preview("second")], "first"), false);
  assert.equal(isCurrentCommitPreview([preview("first"), preview("second")], "second"), true);
});

test("malformed plugin data is never an eligible review or preview", () => {
  for (const data of [null, [], "invalid", 42]) {
    assert.equal(isLatestReviewTurn([{ item: { type: "plugin", kind: "review-result", data } }], "score"), false);
    assert.equal(isCurrentCommitPreview([{ type: "plugin", kind: "pi-commit-preview", data }], "id"), false);
  }
});

const previewItem = (proposalId: string) => ({ type: "plugin", kind: "pi-commit-preview", data: { proposalId } });
const resultItem = (summary: unknown, proposalId?: string, ok = true) => ({ type: "plugin", kind: "pi-commit-result", data: { summary, proposalId, ok } });

test("matches a result by proposal id and retains cancellation text", () => {
  const items = [previewItem("one"), resultItem("old", "other"), resultItem("abc1234 title", "one")];
  assert.equal(commitResultSummary(items, "one"), "已提交：abc1234 title");
  assert.equal(commitResultSummary([previewItem("one"), resultItem("已取消提交。", "one", false)], "one"), "已取消提交。");
});

test("legacy result matching stops at the next preview and never borrows another proposal", () => {
  assert.equal(commitResultSummary([previewItem("one"), resultItem("legacy")], "one"), "已提交：legacy");
  assert.equal(commitResultSummary([previewItem("one"), previewItem("two"), resultItem("legacy")], "one"), undefined);
  assert.equal(commitResultSummary([previewItem("one"), resultItem("other", "two"), resultItem("legacy")], "one"), undefined);
  assert.equal(commitResultSummary([resultItem("legacy")], "missing"), undefined);
});

test("ignores result payloads with a non-string summary", () => {
  assert.equal(commitResultSummary([previewItem("one"), resultItem({ text: "invalid" }, "one")], "one"), undefined);
});
