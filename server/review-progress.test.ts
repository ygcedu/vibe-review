import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "./paseo-api-types.ts";
import { cancelVerification, queueReview, type RunContext } from "./review.ts";

const modelReply = [
  "goal: 检查页面按钮",
  "drifts: 无",
  "narrative: 已修改按钮，尚待实际界面检查。",
  "result: done",
  "task_type: verification_required",
  'followups: ["按钮在手机上显示正常吗？"]',
].join("\n");

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for review update");
}

test("review appears before verification and updates in place after it finishes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: modelReply } }] }) }) as Response;
  try {
    let finishVerification!: (value: { status: "passed"; summary: string; evidence: string[]; provider: string }) => void;
    const verification = new Promise<Parameters<typeof finishVerification>[0]>((resolve) => { finishVerification = resolve; });
    const rows: Array<{ id: string; data: Record<string, unknown> }> = [];
    const paseo = { agents: { ref: () => ({ timeline: {
      append: async (item: { id: string; data: Record<string, unknown> }) => { rows.push(item); return { seq: rows.length, epoch: "test" }; },
      refetch: async () => ({ entries: rows.map((item) => ({ item: { ...item, type: "plugin", kind: "review-result" } })) }),
    } }) } } as unknown as PaseoApi;
    const run: RunContext = {
      getLlmConfig: async () => ({ baseUrl: "http://example.test", model: "test", apiKey: "test" }),
      verifyTask: async (_agentId, _request, control) => {
        await control?.onProgress?.("正在读取界面并核对实际效果…");
        return verification;
      },
    };
    const timeline = [
      { type: "user_message", text: "检查页面按钮" },
      { type: "assistant_message", text: "已经修改按钮。" },
    ] as AgentTimelineItem[];
    queueReview(paseo, "agent-review-test", timeline, "turn-review-test", undefined, run);
    await until(() => rows.length >= 1);
    assert.equal(rows[0].data.verificationState, "running");
    assert.equal(rows[0].data.verificationStage, "正在启动独立验证…");
    assert.equal(rows[0].data.verification, undefined);
    assert.deepEqual(rows[0].data.followups, ["按钮在手机上显示正常吗？"]);
    await until(() => rows.length === 2);
    assert.equal(rows[1].data.verificationStage, "正在读取界面并核对实际效果…");
    finishVerification({ status: "passed", summary: "按钮已显示", evidence: ["页面可见按钮"], provider: "test" });
    await until(() => rows.length === 3);
    assert.equal(rows[2].id, rows[0].id);
    assert.equal(rows[2].data.verificationState, "complete");
    assert.equal((rows[2].data.verification as { summary: string }).summary, "按钮已显示");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancel archives the verifier and keeps later verification from overwriting the card", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: modelReply } }] }) }) as Response;
  try {
    let finishVerification!: (value: { status: "passed"; summary: string; evidence: string[]; provider: string }) => void;
    const verification = new Promise<Parameters<typeof finishVerification>[0]>((resolve) => { finishVerification = resolve; });
    const rows: Array<{ id: string; data: Record<string, unknown> }> = [];
    let archived = 0;
    const paseo = { agents: { ref: (id: string) => id === "verifier-test" ? { archive: async () => { archived++; if (archived === 1) throw new Error("Transport closed"); return { archivedAt: "now" }; } } : { timeline: {
      append: async (item: { id: string; data: Record<string, unknown> }) => { rows.push(item); return { seq: rows.length, epoch: "test" }; },
      refetch: async () => { throw new Error("Transport closed"); },
    } } } } as unknown as PaseoApi;
    const run: RunContext = {
      getLlmConfig: async () => ({ baseUrl: "http://example.test", model: "test", apiKey: "test" }),
      verifyTask: async (_agentId, _request, control) => {
        await control?.onAgentCreated("verifier-test");
        return verification;
      },
    };
    queueReview(paseo, "agent-cancel-test", [{ type: "user_message", text: "检查页面按钮" }] as AgentTimelineItem[], "turn-cancel-test", undefined, run);
    await until(() => rows.length === 2);
    const scoredAt = rows[0].data.scoredAt as string;
    await cancelVerification(paseo, "agent-cancel-test", scoredAt);
    await until(() => archived === 2);
    assert.equal(rows.at(-1)?.data.verificationState, "canceled");
    finishVerification({ status: "passed", summary: "迟到的结果", evidence: ["页面可见按钮"], provider: "test" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(rows.at(-1)?.data.verificationState, "canceled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
