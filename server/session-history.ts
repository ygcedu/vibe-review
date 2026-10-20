import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { orderSessions, sessionHistoryRpc, sessionRenameRpc, sessionDeleteRpc, sessionRestoreRpc, type SessionEntry } from "../shared/session-history.ts";

const runFile = promisify(execFile);
type Paseo = PluginHandlerContext["paseo"];
type SessionIdentity = { id: string; workspaceId?: string; cwd: string; createdAt: string };
export function requireSessionWorkspace(agent: SessionIdentity | null | undefined, workspaceId: string, agentId: string) {
  if (!agent || agent.id !== agentId || agent.workspaceId !== workspaceId) throw new Error("会话已删除或不属于当前 workspace，请刷新列表");
  return agent;
}
export function verifyCliIdentity(value: unknown, agent: SessionIdentity) {
  if (typeof value !== "object" || !value || !("Id" in value) || value.Id !== agent.id || !("Cwd" in value) || value.Cwd !== agent.cwd || !("CreatedAt" in value) || value.CreatedAt !== agent.createdAt) throw new Error("CLI 与插件连接的会话不一致，已取消操作");
}
async function runCli(args: string[]) {
  try {
    const result = await runFile("paseo", [...args, "--json"], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("当前主机未安装 Paseo CLI，无法恢复、重命名或永久删除会话");
    const detail = (error as { stderr?: string }).stderr;
    throw new Error(detail?.trim() || String(error));
  }
}
async function checkedAgent(paseo: Paseo, workspaceId: string, agentId: string) {
  const value = await paseo.agents.ref(agentId).refresh();
  return requireSessionWorkspace(value?.agent, workspaceId, agentId);
}
async function mutate(paseo: Paseo, workspaceId: string, agentId: string, args: string[]) {
  const agent = await checkedAgent(paseo, workspaceId, agentId);
  // SDK 0.11.2 lacks rename/hard-delete. CLI runs on this daemon machine;
  // compare the full ID, cwd and creation timestamp before trusting its target.
  verifyCliIdentity(await runCli(["agent", "inspect", agentId]), agent);
  await checkedAgent(paseo, workspaceId, agentId);
  const result = await runCli(args);
  if (args[1] === "delete") {
    if (typeof result !== "object" || !result || !("deletedCount" in result) || result.deletedCount !== 1 || !("agentIds" in result) || !Array.isArray(result.agentIds) || !result.agentIds.includes(agentId)) throw new Error("CLI 未确认删除成功，请刷新后重试");
  } else {
    const updated = await paseo.agents.ref(agentId).refresh();
    if (updated?.agent.title !== args.at(-1)) throw new Error("会话名称未更新成功，请刷新后重试");
  }
  return { ok: true as const };
}
export async function listWorkspaceSessions(paseo: Paseo, workspaceId: string) {
  const sessions: SessionEntry[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ filter: { includeArchived: true }, sort: [{ key: "updated_at", direction: "desc" }], page: { limit: 100, ...(cursor ? { cursor } : {}) } });
    for (const { agent } of page.entries) if (agent.workspaceId === workspaceId) sessions.push({ id: agent.id, title: agent.title, provider: agent.provider, model: agent.model, status: agent.status, updatedAt: agent.updatedAt, lastActivityAt: agent.updatedAt, requiresAttention: agent.requiresAttention, attentionReason: agent.attentionReason, pendingPermissionCount: agent.pendingPermissions?.length ?? 0, archived: Boolean(agent.archivedAt) });
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    if (cursor && cursors.has(cursor)) throw new Error("会话分页游标异常，请刷新重试");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { sessions: orderSessions([...new Map(sessions.map((session) => [session.id, session])).values()]) };
}
export async function restoreWorkspaceSession(paseo: Paseo, workspaceId: string, agentId: string, cli = runCli) {
  await checkedAgent(paseo, workspaceId, agentId);
  const snapshot = (await paseo.agents.ref(agentId).refresh())?.agent;
  if (!snapshot) throw new Error("会话已删除，请刷新列表");
  if (!snapshot.archivedAt) return { ok: true as const };
  if (!snapshot.persistence?.sessionId) throw new Error("会话缺少恢复信息，无法取消归档");
  verifyCliIdentity(await cli(["agent", "inspect", agentId]), snapshot);
  // Importing an archived provider session restores its existing Agent ID.
  // Check again to avoid importing a session that was restored concurrently.
  const current = (await paseo.agents.ref(agentId).refresh())?.agent;
  requireSessionWorkspace(current, workspaceId, agentId);
  if (!current?.archivedAt) return { ok: true as const };
  await cli(["agent", "import", snapshot.persistence.sessionId, "--provider", snapshot.provider, "--cwd", snapshot.cwd]);
  const restored = (await paseo.agents.ref(agentId).refresh())?.agent;
  requireSessionWorkspace(restored, workspaceId, agentId);
  if (restored?.archivedAt) throw new Error("取消归档失败，未打开会话，请刷新后重试");
  return { ok: true as const };
}
export function registerSessionHistory(server: PluginServerContext) {
  server.handle(sessionRestoreRpc, ({ workspaceId, agentId }, { paseo }) => restoreWorkspaceSession(paseo, workspaceId, agentId));
  server.handle(sessionHistoryRpc, ({ workspaceId }, { paseo }) => listWorkspaceSessions(paseo, workspaceId));
  server.handle(sessionRenameRpc, ({ workspaceId, agentId, title }, { paseo }) => mutate(paseo, workspaceId, agentId, ["agent", "update", agentId, "--name", title]));
  server.handle(sessionDeleteRpc, ({ workspaceId, agentId }, { paseo }) => mutate(paseo, workspaceId, agentId, ["agent", "delete", agentId]));
}
