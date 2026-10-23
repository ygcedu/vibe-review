import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "../paseo-api-types.ts";
import { cancelVerification, publishReviewCard, reconcileVerification, type ReviewCardData } from "./verification.ts";
import type { VerificationControl, VerificationResult } from "./verify.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const passed: VerificationResult = { status: "passed", summary: "按钮可见", evidence: ["页面快照包含按钮"], provider: "test" };
function fixture() {
  const agentId = randomUUID();
  const scoredAt = "2026-10-23T01:00:00.000Z";
  const card: ReviewCardData = {
    verdict: "pass", completed: 1, drift: "in_scope", summary: "检查按钮", goal: "修复按钮", narrative: "已修改按钮",
    result: "done", taskType: "verification_required", scoredAt, verificationState: "running", verificationStage: "正在启动独立验证…",
    drifts: [], followups: ["检查移动端"], diff: "本轮差异", fullDiff: "完整差异", detail: "审核提示词", turnId: "turn-1",
  };
  const rows: Array<{ id: string; data: ReviewCardData }> = [];
  let stored = { type: "plugin" as const, id: "review-1", pluginId: "vibe-review", kind: "review-result", version: 1, data: card };
  let archived = 0;
  let recoveries = 0;
  const timeline = {
    refetch: async () => ({ entries: [{ item: stored }] }),
    append: async (item: { id: string; data: ReviewCardData }) => {
      rows.push(item);
      stored = { ...stored, ...item };
      return { seq: rows.length, epoch: "test" };
    },
  };
  const verifier = {
    refresh: async () => ({ agent: { status: "idle", activeTurn: null, provider: "test" } }),
    current: () => ({ status: "idle", activeTurn: null, provider: "test" }),
    waitForFinish: async () => {
      recoveries++;
      return { status: "idle", lastMessage: JSON.stringify({ ...passed, cases: [{ name: "按钮", steps: ["打开页面"], expected: "可见", actual: "可见", status: "passed" }] }) };
    },
    timeline: { refetch: async () => ({ entries: [{ item: { type: "tool_call", name: "shell", status: "completed" } }] }) },
    archive: async () => { archived++; return { archivedAt: "now" }; },
  };
  const paseo = { agents: { ref: (id: string) => id === agentId ? { timeline } : verifier } } as unknown as PaseoApi & PluginHandlerContext["paseo"];
  const result = deferred<VerificationResult>();
  let control!: VerificationControl;
  let starts = 0;
  const started = deferred<void>();
  const run = { verifyTask: async (_id: string, request: { goal: string; narrative: string }, callbacks?: VerificationControl) => {
    starts++;
    assert.deepEqual(request, { goal: card.goal, narrative: card.narrative });
    control = callbacks!;
    started.resolve();
    return result.promise;
  } };
  return {
    agentId, scoredAt, card, paseo, timeline, rows, verifier, run, result, started,
    get control() { return control; }, get starts() { return starts; },
    get archived() { return archived; }, get recoveries() { return recoveries; },
    get stored() { return stored; },
    publish: () => publishReviewCard(paseo, agentId, stored.id, card, run),
  };
}

test("one card drives progress and completion without dropping its review metadata", async () => {
  const f = fixture();
  const publication = f.publish();
  await f.started.promise;
  await f.control.onAgentCreated("verifier-1");
  await f.control.onProgress?.("检查实际界面");
  await f.control.onProgress?.("检查实际界面");
  f.result.resolve(passed);
  const completed = await publication;
  assert.equal(f.starts, 1);
  assert.equal(f.rows.length, 4);
  assert.equal(completed?.verificationState, "complete");
  assert.equal(completed?.verificationAgentId, "verifier-1");
  assert.equal(completed?.verificationStage, undefined);
  assert.equal(completed?.verdict, "pass");
  for (const field of ["diff", "fullDiff", "detail", "turnId", "followups"] as const) assert.deepEqual(completed?.[field], f.card[field]);
  assert.ok(f.rows.every(({ id }) => id === "review-1"));
  await f.control.onProgress?.("迟到的进度");
  assert.equal(f.rows.length, 4);
});

test("cards without verification publish once and do not dispatch a verifier", async () => {
  const f = fixture();
  const card = { ...f.card, verificationState: undefined, verificationStage: undefined };
  assert.deepEqual(await publishReviewCard(f.paseo, f.agentId, "review-1", card, f.run), card);
  assert.equal(f.starts, 0);
  assert.equal(f.rows.length, 1);
});

test("failed initial publication does not start verification and releases its reservation", async () => {
  const f = fixture();
  const append = f.timeline.append;
  f.timeline.append = async () => { throw new Error("卡片写入失败"); };
  assert.equal(await f.publish(), null);
  assert.equal(f.starts, 0);
  f.timeline.append = append;
  f.result.resolve(passed);
  assert.equal((await f.publish())?.verificationState, "complete");
  assert.equal(f.starts, 1);
});

test("duplicate publication cannot create two verifiers for the same card", async () => {
  const f = fixture();
  const publication = f.publish();
  await f.started.promise;
  assert.equal(await f.publish(), null);
  assert.equal(f.starts, 1);
  f.result.resolve(passed);
  await publication;
});

test("verifier errors downgrade claimed completion while retaining the original review", async () => {
  const f = fixture();
  const publication = f.publish();
  await f.started.promise;
  f.result.reject(new Error("验证工具不可用"));
  const card = await publication;
  assert.equal(card?.result, "unknown");
  assert.equal(card?.completed, 0.5);
  assert.equal(card?.verdict, "review");
  assert.equal(card?.verification?.summary, "验证工具不可用");
  assert.deepEqual(card?.followups, f.card.followups);
});

test("cancellation during initial publication is serialized and avoids starting a verifier", async () => {
  const f = fixture();
  const entered = deferred<void>();
  const release = deferred<void>();
  const append = f.timeline.append;
  f.timeline.append = async (item) => {
    if (item.data.verificationState === "running") { entered.resolve(); await release.promise; }
    return append(item);
  };
  const publication = f.publish();
  await entered.promise;
  const cancellation = cancelVerification(f.paseo, f.agentId, f.scoredAt);
  release.resolve();
  await cancellation;
  assert.equal(await publication, null);
  assert.equal(f.starts, 0);
  assert.equal(f.stored.data.verificationState, "canceled");
});

test("cancel wins over queued progress and suppresses a late successful result", async () => {
  const f = fixture();
  const publication = f.publish();
  await f.started.promise;
  await f.control.onAgentCreated("verifier-1");
  const entered = deferred<void>();
  const release = deferred<void>();
  const append = f.timeline.append;
  f.timeline.append = async (item) => {
    if (item.data.verificationStage === "检查页面") { entered.resolve(); await release.promise; }
    return append(item);
  };
  f.control.onProgress?.("检查页面");
  await entered.promise;
  f.control.onProgress?.("排队中的进度");
  const cancellation = cancelVerification(f.paseo, f.agentId, f.scoredAt);
  assert.equal(f.control.isCanceled(), true);
  f.result.resolve(passed);
  release.resolve();
  await cancellation;
  assert.equal(await publication, null);
  assert.equal(f.archived, 1);
  assert.equal(f.stored.data.verificationState, "canceled");
  assert.equal(f.stored.data.verificationAgentId, undefined);
  assert.ok(!f.rows.some(({ data }) => data.verificationStage === "排队中的进度" || data.verificationState === "complete"));
});

test("a verifier created after cancellation is still archived", async () => {
  const f = fixture();
  const publication = f.publish();
  await f.started.promise;
  await cancelVerification(f.paseo, f.agentId, f.scoredAt);
  await f.control.onAgentCreated("late-verifier");
  f.result.resolve(passed);
  assert.equal(await publication, null);
  assert.equal(f.archived, 1);
  assert.equal(f.stored.data.verificationState, "canceled");
});

test("failed cancellation can retry its write and archives the verifier immediately", async () => {
  const f = fixture();
  const publication = f.publish();
  await f.started.promise;
  await f.control.onAgentCreated("verifier-1");
  const append = f.timeline.append;
  let attempts = 0;
  f.timeline.append = async (item) => {
    if (item.data.verificationState === "canceled" && ++attempts === 1) throw new Error("取消状态写入失败");
    return append(item);
  };
  await assert.rejects(cancelVerification(f.paseo, f.agentId, f.scoredAt), /写入失败/);
  assert.equal(f.archived, 1);
  await cancelVerification(f.paseo, f.agentId, f.scoredAt);
  f.result.resolve(passed);
  assert.equal(await publication, null);
  assert.equal(attempts, 2);
  assert.equal(f.stored.data.verificationState, "canceled");
});

test("recovery shares the cancellation queue and cannot overwrite a canceled card", async () => {
  const f = fixture();
  f.card.verificationAgentId = "verifier-1";
  const entered = deferred<void>();
  const finish = deferred<void>();
  const wait = f.verifier.waitForFinish;
  f.verifier.waitForFinish = async () => { entered.resolve(); await finish.promise; return wait(); };
  const recovery = reconcileVerification(f.paseo, f.agentId, f.scoredAt);
  await entered.promise;
  await reconcileVerification(f.paseo, f.agentId, f.scoredAt);
  await cancelVerification(f.paseo, f.agentId, f.scoredAt);
  finish.resolve();
  await recovery;
  assert.equal(f.recoveries, 1);
  assert.equal(f.archived, 1);
  assert.equal(f.stored.data.verificationState, "canceled");
  assert.ok(!f.rows.some(({ data }) => data.verificationState === "complete"));
});

test("recovery completes the latest persisted card rather than an obsolete snapshot", async () => {
  const f = fixture();
  f.card.verificationAgentId = "verifier-1";
  const entered = deferred<void>();
  const finish = deferred<void>();
  const wait = f.verifier.waitForFinish;
  f.verifier.waitForFinish = async () => { entered.resolve(); await finish.promise; return wait(); };
  const recovery = reconcileVerification(f.paseo, f.agentId, f.scoredAt);
  await entered.promise;
  f.stored.data = { ...f.card, followups: ["最新的补充问题"], detail: "最新审核提示词" };
  finish.resolve();
  await recovery;
  assert.equal(f.stored.data.verificationState, "complete");
  assert.deepEqual(f.stored.data.followups, ["最新的补充问题"]);
  assert.equal(f.stored.data.detail, "最新审核提示词");
  assert.equal(f.stored.data.result, "done");
});


for (const [original, status, expected] of [
  ["done", "passed", "done"],
  ["done", "failed", "partial"],
  ["done", "unavailable", "unknown"],
  ["partial", "passed", "partial"],
  ["none", "passed", "none"],
  [undefined, "passed", "unknown"],
] as const) {
  test(`live and recovered cards agree for ${original ?? "legacy"} / ${status}`, async () => {
    const live = fixture();
    live.card.result = original;
    live.result.resolve({ ...passed, status });
    const completed = await live.publish();
    const recovered = fixture();
    recovered.card.result = original;
    recovered.card.verificationAgentId = "verifier-1";
    recovered.verifier.waitForFinish = async () => ({ status: "idle", lastMessage: JSON.stringify({
      ...passed, status, cases: [{ name: "按钮", steps: ["读取页面"], expected: "可见", actual: "已检查", status: status === "failed" ? "failed" : "passed" }],
    }) });
    await reconcileVerification(recovered.paseo, recovered.agentId, recovered.scoredAt);
    assert.ok(completed);
    assert.equal(completed.result, expected);
    assert.equal(recovered.stored.data.result, expected);
    assert.equal(recovered.stored.data.verdict, completed.verdict);
    assert.equal(recovered.stored.data.completed, completed.completed);
  });
}
