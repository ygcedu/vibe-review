import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import { fetchReviewHistory } from "./turn-history.ts";
import { buildTaskSummary } from "./inspect.ts";

type Page = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
function page(items: Array<{ type: string; text: string }>, hasOlder = false, cursor = 1): Page {
  return {
    entries: items.map((item) => ({ item })), epoch: "test", hasOlder,
    startCursor: { epoch: "test", seq: cursor },
  } as unknown as Page;
}

test("loads the task beyond a page of tool activity and preserves chronological order", async () => {
  const pages = [
    page([{ type: "assistant_message", text: "Finished" }], true, 20),
    page([{ type: "user_message", text: "Fix the bug" }], true, 10),
    page([{ type: "user_message", text: "Earlier context" }]),
  ];
  const directions: unknown[] = [];
  const history = await fetchReviewHistory({ refetch: async (options) => {
    directions.push(options?.direction);
    return pages.shift()!;
  } });
  const summary = buildTaskSummary(history);
  assert.deepEqual(directions, ["tail", "before", "before"]);
  assert.equal(summary.task, "Fix the bug");
  assert.deepEqual(summary.userMessages, ["Earlier context", "Fix the bug"]);
  assert.deepEqual(summary.assistantMessages, ["Finished"]);
});

test("stops after loading enough recent user context", async () => {
  let calls = 0;
  const history = await fetchReviewHistory({ refetch: async () => {
    calls++;
    return page(Array.from({ length: 6 }, (_, i) => ({ type: "user_message", text: String(i) })), true);
  } });
  assert.equal(calls, 1);
  assert.equal(buildTaskSummary(history).task, "5");
});

test("rejects history replacement instead of combining different epochs", async () => {
  let calls = 0;
  await assert.rejects(fetchReviewHistory({ refetch: async () => {
    calls++;
    return { ...page([], true), epoch: calls === 1 ? "old" : "new" };
  } }), /history changed/);
});

test("rejects non-advancing cursors rather than looping forever", async () => {
  await assert.rejects(fetchReviewHistory({ refetch: async () => page([], true) }), /cursor did not advance/);
});
