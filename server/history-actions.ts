import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { historyActionApplyRpc, historyActionPreviewRpc, type HistoryAction } from "../shared/history-actions.ts";
import { git, workspaceGitDirectory } from "./git.ts";

type Preview = { cwd: string; hash: string; action: HistoryAction; head: string; branch: string; expires: number };
const previews = new Map<string, Preview>();
const running = new Set<string>();

export async function historyHead(cwd: string) {
  return { head: (await git(cwd, ["rev-parse", "--verify", "HEAD"])).trim(), branch: (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"]).catch(() => "")).trim() };
}
export async function prepareHistoryAction(cwd: string, hash: string, action: HistoryAction) {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error("无效提交 Hash");
  if ((await git(cwd, ["rev-parse", "--verify", `${hash}^{commit}`])).trim() !== hash) throw new Error("提交不存在");
  const { head, branch } = await historyHead(cwd);
  const message = (await git(cwd, ["show", "-s", "--format=%B", hash])).trimEnd();
  for (const [token, preview] of previews) if (preview.expires < Date.now()) previews.delete(token);
  const token = randomUUID();
  previews.set(token, { cwd, hash, action, head, branch, expires: Date.now() + 600_000 });
  return { token, head, branch: branch.replace(/^refs\/heads\//, ""), message };
}
export async function checkedRefName(cwd: string, name: string | undefined, namespace: "heads" | "tags") {
  if (!name || name !== name.trim() || name.startsWith("-") || name === "HEAD") throw new Error("请输入有效名称");
  await git(cwd, ["check-ref-format", `refs/${namespace}/${name}`]).catch(() => { throw new Error("名称包含 Git 不允许的字符"); });
  return name;
}
export async function applyHistoryAction(cwd: string, token: string, input: { name?: string; message?: string }) {
  const preview = previews.get(token);
  if (!preview || preview.cwd !== cwd || preview.expires < Date.now()) throw new Error("操作预览已过期，请重新打开菜单");
  if (running.has(cwd)) throw new Error("当前工作区已有 Git 操作正在执行");
  running.add(cwd);
  try {
    const current = await historyHead(cwd);
    if (current.head !== preview.head || current.branch !== preview.branch) throw new Error("当前分支或 HEAD 已变化，请重新打开操作");
    let summary: string;
    switch (preview.action) {
      case "new-tag": {
        const name = await checkedRefName(cwd, input.name, "tags");
        await git(cwd, ["-c", "tag.gpgSign=false", "tag", "--", name, preview.hash]);
        summary = `已创建标签 ${name}`;
        break;
      }
      case "new-branch": {
        const name = await checkedRefName(cwd, input.name, "heads");
        await git(cwd, ["branch", "--", name, preview.hash]);
        summary = `已创建分支 ${name}`;
        break;
      }
    }
    previews.delete(token);
    return { summary };
  } finally { running.delete(cwd); }
}
export function registerHistoryActions(server: PluginServerContext) {
  server.handle(historyActionPreviewRpc, async ({ workspaceId, hash, action }, { paseo }) => prepareHistoryAction(await workspaceGitDirectory(paseo, workspaceId), hash, action));
  server.handle(historyActionApplyRpc, async ({ workspaceId, token, ...input }, { paseo }) => applyHistoryAction(await workspaceGitDirectory(paseo, workspaceId), token, input));
}
