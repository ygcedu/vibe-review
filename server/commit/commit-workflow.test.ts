import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { COMMIT_PREVIEW_KIND, COMMIT_RESULT_KIND } from "../../shared/commit.ts";
import { CommitWorkflow } from "./commit-workflow.ts";
import { preparePiCommit, confirmPiCommit, hasPendingCodeChanges, type CommitProposal } from "./pi-commit.ts";
import { loadCommitProposal, removeCommitProposal, saveCommitProposal } from "./commit-proposals.ts";

type Paseo = PluginHandlerContext["paseo"];
type Dependencies = NonNullable<ConstructorParameters<typeof CommitWorkflow>[1]>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("workflow did not reach the expected state");
}

function fixture(overrides: Dependencies = {}) {
  const agentId = "agent-1";
  const input = { agentId, cwd: "/repo", scoredAt: "score-1" };
  const agent = { cwd: input.cwd, activeTurn: null as object | null };
  const entries: Array<{ item: AgentTimelineItem; turnId?: string }> = [
    { item: { type: "user_message", text: "修复按钮" } as AgentTimelineItem, turnId: "turn-1" },
    { item: { type: "plugin", id: "review-1", pluginId: "vibe-review", version: 1, kind: "review-result", data: { scoredAt: input.scoredAt, turnId: "turn-1" } } as AgentTimelineItem },
  ];
  const rows: Array<{ type: "plugin"; id: string; kind: string; version: number; data: unknown }> = [];
  const timeline = {
    refetch: async () => ({ entries: [...entries] }),
    append: async (item: typeof rows[number]) => {
      rows.push(item);
      entries.push({ item: item as AgentTimelineItem });
      return { seq: rows.length, epoch: "test" };
    },
  };
  const paseo = { agents: { ref: () => ({ current: () => agent, refresh: async () => ({ agent }), timeline }) } } as unknown as Paseo;
  const stored = new Map<string, CommitProposal>();
  const generations: Array<{ result: ReturnType<typeof deferred<CommitProposal>>; progress: Parameters<typeof preparePiCommit>[4]; diff: Parameters<typeof preparePiCommit>[5] }> = [];
  const confirmed: CommitProposal[] = [];
  const dependencies: Dependencies = {
    preparePiCommit: async (_id, _cwd, _config, _context, progress, diff) => {
      const result = deferred<CommitProposal>();
      generations.push({ result, progress, diff });
      return result.promise;
    },
    loadCommitProposal: async (id, proposalId) => {
      const proposal = stored.get(id);
      if (proposal && proposal.expiresAt < Date.now()) { stored.delete(id); return undefined; }
      return proposalId === undefined || proposalId === proposal?.id ? proposal : undefined;
    },
    saveCommitProposal: async (proposal) => { stored.set(proposal.agentId, proposal); },
    removeCommitProposal: async (id, proposalId) => { if (stored.get(id)?.id === proposalId) stored.delete(id); },
    confirmPiCommit: async (proposal) => { confirmed.push(proposal); return `abc1234 ${proposal.message}`; },
    hasPendingCodeChanges: async () => true,
    ...overrides,
  };
  const newWorkflow = (readConfig = async () => ({ config: { executable: "pi", provider: "", model: "" }, prompt: "生成中文提交标题" })) => new CommitWorkflow(readConfig, dependencies);
  const workflow = newWorkflow();
  const proposal = (id = "proposal-1"): CommitProposal => ({
    id, agentId, cwd: input.cwd, head: "head-1", message: "修复按钮", files: ["button.ts"], diff: "完整差异", promptPreview: "提示词", expiresAt: Date.now() + 600_000,
  });
  const ready = async () => {
    await workflow.prepare(paseo, input);
    generations.at(-1)!.result.resolve(proposal());
    await until(async () => (await workflow.status(agentId)).kind === "ready");
  };
  return { workflow, newWorkflow, paseo, input, agent, entries, rows, timeline, stored, generations, confirmed, proposal, ready };
}

test("preparation publishes progress and diff, then confirmation consumes the preview", async () => {
  const f = fixture();
  assert.equal((await f.workflow.availability(f.paseo, f.input.agentId, f.input.scoredAt)).available, true);
  await f.workflow.prepare(f.paseo, f.input);
  assert.equal((await f.workflow.status(f.input.agentId)).kind, "preparing");
  assert.equal((await f.workflow.availability(f.paseo, f.input.agentId, f.input.scoredAt)).available, false);
  f.generations[0].progress?.("正在拟定中文提交说明");
  f.generations[0].diff?.("候选差异");
  assert.equal((await f.workflow.status(f.input.agentId)).stage, "正在拟定中文提交说明");
  assert.equal((await f.workflow.status(f.input.agentId)).diffReady, true);
  assert.deepEqual(f.workflow.pendingDiff(f.input.agentId), { diff: "候选差异" });
  f.generations[0].result.resolve(f.proposal());
  await until(async () => (await f.workflow.status(f.input.agentId)).kind === "ready");
  assert.equal(f.rows[0].kind, COMMIT_PREVIEW_KIND);
  assert.equal((await f.workflow.status(f.input.agentId)).diffReady, false);
  assert.throws(() => f.workflow.pendingDiff(f.input.agentId), /尚未准备好或已过期/);
  assert.deepEqual(await f.workflow.preview(f.paseo, f.input.agentId, "proposal-1"), { state: "pending", diff: "完整差异" });
  assert.equal((await f.workflow.availability(f.paseo, f.input.agentId, f.input.scoredAt)).available, false);
  const result = await f.workflow.confirm(f.paseo, f.input.agentId, "proposal-1", "修复移动端按钮");
  assert.match(result.summary, /修复移动端按钮/);
  assert.equal(f.confirmed.length, 1);
  assert.equal(f.confirmed[0].message, "修复移动端按钮");
  assert.equal(f.rows[1].kind, COMMIT_RESULT_KIND);
  assert.equal(f.stored.size, 0);
  assert.equal((await f.workflow.status(f.input.agentId)).kind, "finished");
  assert.deepEqual(await f.workflow.preview(f.paseo, f.input.agentId, "proposal-1"), { state: "finished", result: "已提交：abc1234 修复移动端按钮" });
  await assert.rejects(f.workflow.confirm(f.paseo, f.input.agentId, "proposal-1", "重复提交"), /已失效/);
  assert.equal(f.confirmed.length, 1);
});

test("cancellation consumes the proposal, writes its result and is idempotent", async () => {
  const f = fixture();
  await f.ready();
  await f.workflow.cancel(f.paseo, f.input.agentId, "proposal-1");
  await f.workflow.cancel(f.paseo, f.input.agentId, "proposal-1");
  assert.equal(f.rows.length, 2);
  assert.equal(f.stored.size, 0);
  assert.equal(f.confirmed.length, 0);
  assert.equal((await f.workflow.status(f.input.agentId)).kind, "finished");
  assert.deepEqual(await f.workflow.preview(f.paseo, f.input.agentId, "proposal-1"), { state: "finished", result: "已取消提交。" });
});

test("preflight reserves the agent before configuration or storage awaits", async () => {
  const f = fixture();
  const config = deferred<{ config: { executable: string; provider: string; model: string }; prompt: string }>();
  const workflow = f.newWorkflow(() => config.promise);
  const first = workflow.prepare(f.paseo, f.input);
  await assert.rejects(workflow.prepare(f.paseo, f.input), /Pi 已在/);
  config.reject(new Error("配置读取失败"));
  await assert.rejects(first, /配置读取失败/);
  assert.equal((await workflow.status(f.input.agentId)).kind, "idle");
});

test("new turns invalidate late producers and their progress without blocking a new preview", async () => {
  const f = fixture();
  await f.workflow.prepare(f.paseo, f.input);
  const old = f.generations[0];
  old.diff?.("旧差异");
  await f.workflow.resetForTurn(f.input.agentId);
  assert.equal((await f.workflow.status(f.input.agentId)).kind, "idle");
  await f.workflow.prepare(f.paseo, f.input);
  old.progress?.("迟到的旧进度");
  old.diff?.("迟到的旧差异");
  old.result.resolve(f.proposal("old"));
  f.generations[1].diff?.("新差异");
  assert.deepEqual(f.workflow.pendingDiff(f.input.agentId), { diff: "新差异" });
  f.generations[1].result.resolve(f.proposal("new"));
  await until(async () => (await f.workflow.status(f.input.agentId)).kind === "ready");
  assert.deepEqual(f.rows.map((row) => (row.data as { proposalId: string }).proposalId), ["new"]);
  assert.equal(f.stored.get(f.input.agentId)?.id, "new");
});

test("reset during proposal persistence cleans up the late save without publishing it", async () => {
  const saving = deferred<void>();
  const release = deferred<void>();
  const f = fixture({ saveCommitProposal: async (proposal) => {
    saving.resolve();
    await release.promise;
    f.stored.set(proposal.agentId, proposal);
  } });
  await f.workflow.prepare(f.paseo, f.input);
  f.generations[0].result.resolve(f.proposal());
  await saving.promise;
  const resetting = f.workflow.resetForTurn(f.input.agentId);
  await assert.rejects(f.workflow.prepare(f.paseo, f.input), /正在清理/);
  release.resolve();
  await resetting;
  assert.equal(f.stored.size, 0);
  assert.equal(f.rows.length, 0);
  assert.equal((await f.workflow.status(f.input.agentId)).kind, "idle");
});

test("publication failure removes persisted previews and candidate diffs, permitting retry", async () => {
  const f = fixture();
  f.timeline.append = async () => { throw new Error("写入卡片失败"); };
  await f.workflow.prepare(f.paseo, f.input);
  f.generations[0].diff?.("待提交差异");
  f.generations[0].result.resolve(f.proposal());
  await until(async () => (await f.workflow.status(f.input.agentId)).kind === "failed" && f.stored.size === 0);
  assert.match((await f.workflow.status(f.input.agentId)).stage, /写入卡片失败/);
  assert.throws(() => f.workflow.pendingDiff(f.input.agentId), /尚未准备好或已过期/);
  await f.workflow.prepare(f.paseo, f.input);
  assert.equal(f.generations.length, 2);
  f.generations[1].result.reject(new Error("模型失败"));
  await until(async () => (await f.workflow.status(f.input.agentId)).kind === "failed");
});

test("reload restores persisted previews and expiration disables their confirmation", async () => {
  const f = fixture();
  await f.ready();
  const restored = f.newWorkflow();
  assert.equal((await restored.status(f.input.agentId)).kind, "ready");
  assert.deepEqual(await restored.preview(f.paseo, f.input.agentId, "proposal-1"), { state: "pending", diff: "完整差异" });
  await restored.confirm(f.paseo, f.input.agentId, "proposal-1", "重载后提交");
  assert.equal(f.confirmed.length, 1);
  assert.equal((await restored.status(f.input.agentId)).kind, "finished");

  const expired = fixture();
  await expired.ready();
  expired.stored.get(expired.input.agentId)!.expiresAt = Date.now() - 1;
  assert.equal((await expired.workflow.status(expired.input.agentId)).kind, "failed");
  assert.match((await expired.workflow.status(expired.input.agentId)).stage, /过期/);
  await assert.rejects(expired.workflow.confirm(expired.paseo, expired.input.agentId, "proposal-1", "过期提交"), /失效/);
  assert.deepEqual(await expired.workflow.preview(expired.paseo, expired.input.agentId, "proposal-1"), { state: "stale" });
});

test("confirmation and cancellation share one lock, including across turn reset", async () => {
  const committing = deferred<string>();
  const entered = deferred<void>();
  const f = fixture({ confirmPiCommit: async () => { entered.resolve(); return committing.promise; } });
  await f.ready();
  const confirmation = f.workflow.confirm(f.paseo, f.input.agentId, "proposal-1", "确认提交");
  await entered.promise;
  await assert.rejects(f.workflow.confirm(f.paseo, f.input.agentId, "proposal-1", "重复提交"), /正在提交/);
  await assert.rejects(f.workflow.cancel(f.paseo, f.input.agentId, "proposal-1"), /正在提交/);
  await f.workflow.resetForTurn(f.input.agentId);
  await assert.rejects(f.workflow.prepare(f.paseo, f.input), /正在提交/);
  committing.resolve("abc1234 确认提交");
  await confirmation;
  assert.equal((await f.workflow.status(f.input.agentId)).kind, "finished");
});

test("failed confirmation releases the lock and leaves the preview available to cancel", async () => {
  const f = fixture({ confirmPiCommit: async () => { throw new Error("HEAD 已变化"); } });
  await f.ready();
  await assert.rejects(f.workflow.confirm(f.paseo, f.input.agentId, "proposal-1", "提交"), /HEAD 已变化/);
  assert.equal((await f.workflow.status(f.input.agentId)).kind, "ready");
  assert.equal(f.rows.length, 1);
  await f.workflow.cancel(f.paseo, f.input.agentId, "proposal-1");
  assert.equal(f.stored.size, 0);
});

test("workspace and latest-turn guards reject stale preparations and confirmations", async () => {
  const f = fixture();
  await assert.rejects(f.workflow.prepare(f.paseo, { ...f.input, cwd: "/other" }), /工作目录已变化/);
  await assert.rejects(f.workflow.prepare(f.paseo, { ...f.input, scoredAt: "old-score" }), /不是最后一轮/);
  assert.equal(f.generations.length, 0);
  await f.ready();
  f.agent.cwd = "/other";
  await assert.rejects(f.workflow.confirm(f.paseo, f.input.agentId, "proposal-1", "提交"), /工作目录已变化/);
  f.agent.cwd = f.input.cwd;
  f.entries.push({ item: { type: "user_message", text: "下一轮" } as AgentTimelineItem });
  assert.deepEqual(await f.workflow.preview(f.paseo, f.input.agentId, "proposal-1"), { state: "stale" });
  await assert.rejects(f.workflow.confirm(f.paseo, f.input.agentId, "proposal-1", "提交"), /不是当前轮次/);
  assert.equal(f.confirmed.length, 0);
});

test("a new user turn detected at generation completion cannot produce a preview", async () => {
  const f = fixture();
  await f.workflow.prepare(f.paseo, f.input);
  f.entries.push({ item: { type: "user_message", text: "新任务" } as AgentTimelineItem });
  f.generations[0].result.resolve(f.proposal());
  await until(async () => (await f.workflow.status(f.input.agentId)).kind === "failed");
  assert.equal(f.stored.size, 0);
  assert.equal(f.rows.length, 0);
});


test("the workflow persists a real Pi preview and commits only its selected files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-commit-workflow-"));
  const agentId = `workflow-${randomUUID()}`;
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(join(cwd, "selected.txt"), "before\n");
    await writeFile(join(cwd, "unrelated.txt"), "before\n");
    git("add", ".");
    git("commit", "-qm", "初始化测试仓库");
    const head = git("rev-parse", "HEAD");
    await writeFile(join(cwd, "selected.txt"), "after\n");
    await writeFile(join(cwd, "unrelated.txt"), "staged\n");
    git("add", "unrelated.txt");
    const executable = join(cwd, "fake-pi");
    const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify({ message: "修复选中文件", files: ["selected.txt"] }) }] } };
    await writeFile(executable, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(event)}\nJSON\n`);
    await chmod(executable, 0o755);
    const f = fixture({ preparePiCommit, confirmPiCommit, hasPendingCodeChanges, loadCommitProposal, removeCommitProposal, saveCommitProposal });
    f.agent.cwd = cwd;
    const workflow = f.newWorkflow(async () => ({ config: { executable, provider: "", model: "" }, prompt: "生成提交预览" }));
    await workflow.prepare(f.paseo, { ...f.input, agentId, cwd });
    // This check includes the real child process and Git snapshot operations.
    for (let i = 0; i < 200; i++) {
      if ((await workflow.status(agentId)).kind !== "preparing") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await workflow.status(agentId)).kind, "ready");
    assert.equal(git("rev-parse", "HEAD"), head);
    const proposal = await loadCommitProposal(agentId);
    assert.ok(proposal);
    assert.deepEqual(proposal.files, ["selected.txt"]);
    assert.deepEqual(await workflow.preview(f.paseo, agentId, proposal.id), { state: "pending", diff: proposal.diff });
    await workflow.confirm(f.paseo, agentId, proposal.id, "修复选中文件内容");
    assert.equal(git("log", "-1", "--pretty=%s"), "修复选中文件内容");
    assert.equal(git("show", "--pretty=format:", "--name-only", "HEAD"), "selected.txt");
    assert.equal(git("diff", "--cached", "--name-only"), "unrelated.txt");
    assert.equal(await loadCommitProposal(agentId), undefined);
    assert.equal((await workflow.status(agentId)).kind, "finished");
  } finally {
    const proposal = await loadCommitProposal(agentId);
    if (proposal) await removeCommitProposal(agentId, proposal.id);
    await rm(cwd, { recursive: true, force: true });
  }
});
