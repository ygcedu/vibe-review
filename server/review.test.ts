import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelVerification, verdictOf } from "./review.ts";
import { reviewResultSchema } from "../shared/review.ts";
import type { PaseoApi } from "./paseo-api-types.ts";

// ponytail: verdictOf 为纯函数，覆盖 result×drift 全组合；runReview 主流程依赖
// distillTask 的真实 LLM fetch，mock 不了，只补取消路径。
test("verdictOf maps LLM result and drift counts onto card verdict", () => {
  assert.deepEqual(verdictOf({ drifts: [], result: "done" }), { verdict: "pass", completed: 1, drift: "in_scope" });
  assert.deepEqual(verdictOf({ drifts: [], result: "partial" }), { verdict: "review", completed: 0.5, drift: "in_scope" });
  assert.deepEqual(verdictOf({ drifts: [], result: "none" }), { verdict: "reject", completed: 0, drift: "in_scope" });
  assert.deepEqual(verdictOf({ drifts: [], result: "unknown" }), { verdict: "review", completed: 0.5, drift: "in_scope" });
  assert.deepEqual(verdictOf({ drifts: ["改了无关文件"], result: "done" }), { verdict: "review", completed: 1, drift: "minor_drift" });
  // verdictOf 用 isNoDrift 过滤“无/没有/none”等占位漂移，不计入漂移数
  assert.deepEqual(verdictOf({ drifts: ["无"], result: "done" }), { verdict: "pass", completed: 1, drift: "in_scope" });
  assert.deepEqual(verdictOf({ drifts: ["a", "b"], result: "done" }), { verdict: "reject", completed: 1, drift: "major_drift" });
  assert.deepEqual(verdictOf({ drifts: ["a", "b"], result: "none" }), { verdict: "reject", completed: 0, drift: "major_drift" });
});

const runningCard = (over: Record<string, unknown> = {}) => reviewResultSchema.parse({
  verdict: "review", completed: 0.5, drift: "in_scope", summary: "任务", scoredAt: "2026-01-01T00:00:00Z",
  verificationState: "running", verificationStage: "正在启动独立验证…",
  followups: ["原建议"], ...over,
});

test("cancelVerification persists a running card as canceled and archives its verifier", async () => {
  let archivedVerifier = false;
  const card = runningCard({ verificationAgentId: "verifier-1" });
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          append: async (item: { id: string; data: unknown }) => {
            assert.equal(item.id, "card-1");
            const data = item.data as Record<string, unknown>;
            assert.equal(data.verificationState, "canceled");
            assert.equal(data.verificationStage, undefined);
            assert.equal(data.verificationAgentId, undefined);
            assert.deepEqual(data.followups, ["原建议"]);
            return { seq: 1, epoch: "e1" };
          },
          refetch: async () => ({ entries: [{ item: { type: "plugin", id: "card-1", kind: "review-result", version: 1, data: card } }] }),
        },
        archive: async () => {
          archivedVerifier = true;
          return { archivedAt: "2026-01-01T00:00:01Z" };
        },
      }),
    },
  } as unknown as PaseoApi;
  await cancelVerification(paseo, "agent-1", "2026-01-01T00:00:00Z");
  // verifier 归档是 fire-and-forget（void 包裹），轮询等它落盘
  for (let i = 0; i < 20 && !archivedVerifier; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(archivedVerifier, true);
});

test("cancelVerification rejects finished cards and missing cards", async () => {
  const done = runningCard({ verificationState: "complete", verification: { status: "passed", summary: "ok", evidence: [], provider: "" } });
  const finishedPaseo = {
    agents: {
      ref: () => ({
        timeline: {
          append: async () => { assert.fail("finished card must not be appended"); },
          refetch: async () => ({ entries: [{ item: { type: "plugin", id: "card-1", kind: "review-result", version: 1, data: done } }] }),
        },
      }),
    },
  } as unknown as PaseoApi;
  await assert.rejects(cancelVerification(finishedPaseo, "agent-1", "2026-01-01T00:00:00Z"), /验证已结束/);

  const noCard = {
    agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: [] }) } }) },
  } as unknown as PaseoApi;
  await assert.rejects(cancelVerification(noCard, "agent-1", "2026-01-01T00:00:00Z"), /已失效/);
});
