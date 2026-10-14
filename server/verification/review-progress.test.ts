import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "../paseo-api-types.ts";
import { verdictOf } from "../review/verdict.ts";
import { cancelVerification, reconcileVerification, openVerification } from "./verification.ts";
import { queueReview, type RunContext } from "../review/run-review.ts";

test("a punctuation-only no-drift answer passes review", () => {
  assert.deepEqual(verdictOf({ result: "done", drifts: ["无。"] }), { verdict: "pass", completed: 1, drift: "in_scope" });
});

test("verification link resolves only the verifier stored on its review card", async () => {
  const scoredAt = "2026-10-04T14:36:00.000Z";
  const parent = { timeline: { refetch: async () => ({ entries: [{ item: {
    type: "plugin", kind: "review-result", data: {
      verdict: "pass", completed: 1, drift: "in_scope", summary: "检查跳转", scoredAt,
      verificationAgentId: "verifier-1", verificationState: "complete",
    },
  } }] }) } };
  const verifier = { refresh: async () => ({ agent: {
    id: "verifier-1", title: "Vibe Review · 验证", labels: {}, archivedAt: null, workspaceId: "workspace-1",
  } }) };
  const paseo = { agents: { ref: (id: string) => id === "parent-1" ? parent : verifier } } as unknown as Parameters<typeof openVerification>[0];
  assert.deepEqual(await openVerification(paseo, "parent-1", scoredAt), { verifierAgentId: "verifier-1", workspaceId: "workspace-1" });
  await assert.rejects(openVerification(paseo, "parent-1", "wrong-card"), /没有保存验证 agent/);
});

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
        await control?.onAgentCreated("verifier-test");
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
    await until(() => rows.length === 3);
    assert.equal(rows[2].data.verificationStage, "正在读取界面并核对实际效果…");
    finishVerification({ status: "passed", summary: "按钮已显示", evidence: ["页面可见按钮"], provider: "test" });
    await until(() => rows.length === 4);
    assert.equal(rows[3].id, rows[0].id);
    assert.equal(rows[3].data.verificationState, "complete");
    assert.equal(rows[3].data.verificationAgentId, "verifier-test");
    assert.equal((rows[3].data.verification as { summary: string }).summary, "按钮已显示");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a code-changing turn shows a pending card before the review model responds", async () => {
  const originalFetch = globalThis.fetch;
  let finishModel!: () => void;
  globalThis.fetch = async () => {
    await new Promise<void>((resolve) => { finishModel = resolve; });
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: modelReply.replace("verification_required", "other") } }] }) } as Response;
  };
  try {
    const rows: Array<{ id: string; data: Record<string, unknown> }> = [];
    const paseo = { agents: { ref: () => ({ timeline: {
      append: async (item: { id: string; data: Record<string, unknown> }) => { rows.push(item); return { seq: rows.length, epoch: "test" }; },
      refetch: async () => ({ entries: rows.map((item) => ({ item: { ...item, type: "plugin", kind: "review-result" } })) }),
    } }) } } as unknown as PaseoApi;
    const run: RunContext = {
      getLlmConfig: async () => ({ baseUrl: "http://example.test", model: "test", apiKey: "test" }),
      verifyTask: async () => ({ status: "unavailable", summary: "", evidence: [], provider: "" }),
    };
    queueReview(paseo, "agent-review-test", [{ type: "user_message", text: "修改按钮" }] as AgentTimelineItem[], "turn-review-test", undefined, run, undefined, { diff: "diff --git a/a b/a", diffIncomplete: false });
    await until(() => rows.length === 1 && Boolean(finishModel));
    assert.equal(rows[0].data.processing, true);
    finishModel();
    await until(() => rows.length === 2);
    assert.equal(rows[1].id, rows[0].id);
    assert.equal(rows[1].data.processing, undefined);
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

test("a finished verifier restores a running card after plugin reload", async () => {
  const scoredAt = new Date().toISOString();
  let card = { type: "plugin", id: "review-1", kind: "review-result", data: {
    verdict: "pass", completed: 1, drift: "in_scope", summary: "检查按钮", scoredAt,
    result: "done", verificationState: "running", verificationStage: "正在选择验证方式…",
    verificationAgentId: "verifier-1", followups: [],
  } } as { type: "plugin"; id: string; kind: string; data: Record<string, unknown> };
  const paseo = { agents: { ref: (id: string) => id === "verifier-1" ? {
    current: () => ({ status: "idle", activeTurn: null, config: { provider: "test/model" } }),
    refresh: async () => ({ agent: { status: "idle", activeTurn: null, config: { provider: "test/model" } } }),
    waitForFinish: async () => ({ status: "idle", lastMessage: JSON.stringify({ status: "passed", summary: "按钮可见", evidence: ["页面快照包含按钮"], cases: [{ name: "按钮", steps: ["打开页面"], expected: "可见", actual: "可见", status: "passed" }] }) }),
    timeline: { refetch: async () => ({ entries: [{ item: { type: "tool_call", name: "browser_snapshot", status: "completed" } }] }) },
  } : { timeline: {
    refetch: async () => ({ entries: [{ item: card }] }),
    append: async (next: typeof card) => { card = next; return { seq: 2, epoch: "test" }; },
  } } } } as unknown as Parameters<typeof reconcileVerification>[0];
  await reconcileVerification(paseo, "parent-1", scoredAt);
  assert.equal(card.data.verificationState, "complete");
  assert.equal((card.data.verification as { summary: string }).summary, "按钮可见");
  assert.equal(card.data.verificationAgentId, "verifier-1");
});
