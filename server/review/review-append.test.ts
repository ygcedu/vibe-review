import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoApi } from "../paseo-api-types.ts";
import { appendReviewWithRetry, fitReviewItem } from "./review-append.ts";
import { REVIEW_KIND, reviewResultSchema } from "../../shared/review.ts";

const item = { type: "plugin" as const, id: "vibe-review-turn-1", kind: "review-result", version: 1, data: {} };

const card = { verdict: "review", completed: 0.5, drift: "in_scope", summary: "审核任务", scoredAt: "now" } as const;

test("large full-context diff does not block a small review diff", () => {
  const original = { ...item, data: { ...card, diff: "small diff", fullDiff: "全文\n".repeat(50000) } };
  const fitted = fitReviewItem(original);
  const parsed = reviewResultSchema.parse(fitted.data);
  assert.equal(parsed.fullDiff, undefined);
  assert.equal(parsed.diff, "small diff");
  assert.ok(Buffer.byteLength(JSON.stringify(fitted.data)) <= 65536);
  assert.ok(original.data.fullDiff.length > 65536);
});

test("oversized UTF-8 diff is omitted and marked incomplete while verdict survives", async () => {
  const original = { ...item, kind: REVIEW_KIND, data: { ...card, diff: "中文\\\"\n".repeat(30000) } };
  let published: unknown;
  const paseo = { agents: { ref: () => ({ timeline: { append: async (value: typeof item) => {
    published = value.data;
    assert.ok(Buffer.byteLength(JSON.stringify(value.data)) <= 65536);
    return { seq: 1, epoch: "test" };
  } } }) } } as unknown as PaseoApi;
  await appendReviewWithRetry(paseo, "agent-1", original);
  const parsed = reviewResultSchema.parse(published);
  assert.equal(parsed.diff, undefined);
  assert.equal(parsed.diffIncomplete, true);
  assert.equal(parsed.verdict, "review");
});

test("large verification output also fits without altering status or agent identity", () => {
  const fitted = fitReviewItem({ ...item, data: { ...card, verificationState: "complete", verificationAgentId: "verifier-1",
    verification: { status: "passed", summary: "通过".repeat(50000), evidence: ["证据".repeat(50000)], provider: "codex" } } });
  const parsed = reviewResultSchema.parse(fitted.data);
  assert.equal(parsed.verification?.status, "passed");
  assert.equal(parsed.verificationAgentId, "verifier-1");
  assert.ok(Buffer.byteLength(JSON.stringify(fitted.data)) <= 65536);
});

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
