import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoApi } from "./paseo-api-types";
import { appendReviewWithRetry } from "./review-append.ts";

const item = { type: "plugin" as const, id: "vibe-review-turn-1", kind: "review-result", version: 1, data: {} };

test("retries a disconnected append without duplicating an already saved card", async () => {
  let calls = 0;
  const paseo = { agents: { ref: () => ({ timeline: {
    append: async () => { calls++; throw Object.assign(new Error("Transport closed"), { code: "DAEMON_CONNECTION_LOST" }); },
    refetch: async () => ({ entries: [{ item }] }),
  } }) } } as unknown as PaseoApi;
  const result = await appendReviewWithRetry(paseo, "agent-1", item);
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("replacement retries even when the earlier version of the card exists", async () => {
  let calls = 0;
  const paseo = { agents: { ref: () => ({ timeline: {
    append: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("Transport closed"), { code: "DAEMON_CONNECTION_LOST" });
      return { seq: 2, epoch: "test" };
    },
    refetch: async () => ({ entries: [{ item }] }),
  } }) } } as unknown as PaseoApi;
  const result = await appendReviewWithRetry(paseo, "agent-1", { ...item, data: { verificationState: "complete" } }, true);
  assert.equal(result?.seq, 2);
  assert.equal(calls, 2);
});
