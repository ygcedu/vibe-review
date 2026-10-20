import { test } from "node:test";
import assert from "node:assert/strict";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { restoreWorkspaceSession, listWorkspaceSessions, requireSessionWorkspace, verifyCliIdentity } from "./session-history.ts";
import { orderSessions, sessionDeleteRpc } from "../shared/session-history.ts";

test("session ordering uses update time descending and stable ID tie-breaks", () => {
  const base = { title: null, provider: "codex", model: null, status: "closed", archived: false };
  const values = [{ ...base, id: "old", updatedAt: "2026-01-01" }, { ...base, id: "b", updatedAt: "2026-02-01" }, { ...base, id: "a", updatedAt: "2026-02-01" }];
  assert.deepEqual(orderSessions(values).map((value) => value.id), ["a", "b", "old"]);
  assert.equal(values[0].id, "old");
});
test("list scans later pages and filters by workspace ID, not matching cwd", async () => {
  const agent = (id: string, workspaceId: string, updatedAt: string) => ({ id, workspaceId, updatedAt, title: id, provider: "codex", model: null, status: "closed", cwd: "/same" });
  const calls: unknown[] = [];
  const paseo = { agents: { list: async (options: { page: { cursor?: string } }) => {
    calls.push(options);
    return options.page.cursor
      ? { entries: [{ agent: agent("new", "current", "2026-02-01") }], pageInfo: { hasMore: false, nextCursor: null } }
      : { entries: [{ agent: agent("other", "other", "2026-03-01") }, { agent: agent("old", "current", "2026-01-01") }], pageInfo: { hasMore: true, nextCursor: "next" } };
  } } } as unknown as PluginHandlerContext["paseo"];
  assert.deepEqual((await listWorkspaceSessions(paseo, "current")).sessions.map((session) => session.id), ["new", "old"]);
  assert.equal(calls.length, 2);
});
test("rename/delete guard rejects cross-workspace, missing and CLI-mismatched identities", () => {
  const agent = { id: "full-id", workspaceId: "current", cwd: "/repo", createdAt: "2026-01-01" };
  assert.equal(requireSessionWorkspace(agent, "current", "full-id"), agent);
  assert.throws(() => requireSessionWorkspace(agent, "other", "full-id"), /不属于/);
  assert.throws(() => requireSessionWorkspace(null, "current", "full-id"), /已删除/);
  verifyCliIdentity({ Id: agent.id, Cwd: agent.cwd, CreatedAt: agent.createdAt }, agent);
  assert.throws(() => verifyCliIdentity({ Id: agent.id, Cwd: "/wrong", CreatedAt: agent.createdAt }, agent), /不一致/);
  assert.throws(() => verifyCliIdentity({ Id: "prefix" }, agent), /不一致/);
});
test("permanent deletion contract requires explicit confirmation", () => {
  assert.equal(sessionDeleteRpc.input.safeParse({ workspaceId: "current", agentId: "full-id" }).success, false);
  assert.equal(sessionDeleteRpc.input.safeParse({ workspaceId: "current", agentId: "full-id", confirmed: true }).success, true);
});

test("restore unarchives before success, keeps original ID, and skips active sessions", async () => {
  const agent = { id: "original", workspaceId: "current", cwd: "/repo", createdAt: "now", provider: "codex", archivedAt: "yesterday", persistence: { sessionId: "thread" } };
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: { ...agent } }) }) } } as unknown as PluginHandlerContext["paseo"];
  const calls: string[][] = [];
  const cli = async (args: string[]) => {
    calls.push(args);
    if (args[1] === "inspect") return { Id: agent.id, Cwd: agent.cwd, CreatedAt: agent.createdAt };
    agent.archivedAt = "";
    return {};
  };
  assert.deepEqual(await restoreWorkspaceSession(paseo, "current", "original", cli), { ok: true });
  assert.deepEqual(calls[1], ["agent", "import", "thread", "--provider", "codex", "--cwd", "/repo"]);
  await restoreWorkspaceSession(paseo, "current", "original", cli);
  assert.equal(calls.length, 2);
  await assert.rejects(restoreWorkspaceSession(paseo, "other", "original", cli), /不属于/);
});
test("restore fails if unarchive fails or persistence is missing", async () => {
  const agent = { id: "original", workspaceId: "current", cwd: "/repo", createdAt: "now", provider: "codex", archivedAt: "yesterday", persistence: { sessionId: "thread" } as { sessionId: string } | null };
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent }) }) } } as unknown as PluginHandlerContext["paseo"];
  const cli = async () => ({ Id: agent.id, Cwd: agent.cwd, CreatedAt: agent.createdAt });
  await assert.rejects(restoreWorkspaceSession(paseo, "current", "original", cli), /取消归档失败/);
  agent.persistence = null;
  await assert.rejects(restoreWorkspaceSession(paseo, "current", "original", cli), /缺少恢复信息/);
});
