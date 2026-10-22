import { historyHead, requireCleanHistoryWorktree, createHistoryBackup } from "./history-repository.ts";
import { planHistoryRewrite, rewriteHistory } from "./history-rewrite.ts";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { historyActionApplyRpc, historyActionPreviewRpc, type HistoryAction } from "../shared/history-actions.ts";
import { git, workspaceGitDirectory } from "./git.ts";

type Preview = { cwd: string; hash: string; action: HistoryAction; head: string; branch: string; expires: number };
const previews = new Map<string, Preview>();
const running = new Set<string>();

export async function prepareHistoryAction(cwd: string, hash: string, action: HistoryAction) {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error("无效提交 Hash");
  if ((await git(cwd, ["rev-parse", "--verify", `${hash}^{commit}`])).trim() !== hash) throw new Error("提交不存在");
  const { head, branch } = await historyHead(cwd);
  if (action === "checkout" || action === "cherry-pick" || action === "reset") await requireCleanHistoryWorktree(cwd);
  if (action === "reset" && !branch) throw new Error("当前处于分离 HEAD，无法重置当前分支");
  if (action === "reword" || action === "drop") { await requireCleanHistoryWorktree(cwd); await planHistoryRewrite(cwd, hash); }
  const message = (await git(cwd, ["show", "-s", "--format=%B", hash])).trimEnd();
  for (const [token, preview] of previews) if (preview.expires < Date.now()) previews.delete(token);
  const token = randomUUID();
  previews.set(token, { cwd, hash, action, head, branch, expires: Date.now() + 600_000 });
  const parents = (await git(cwd, ["show", "-s", "--format=%P", hash])).trim().split(" ").filter(Boolean);
  return { token, head, parents, branch: branch.replace(/^refs\/heads\//, ""), message };
}
export async function checkedRefName(cwd: string, name: string | undefined, namespace: "heads" | "tags") {
  if (!name || name !== name.trim() || name.startsWith("-") || name === "HEAD") throw new Error("请输入有效名称");
  await git(cwd, ["check-ref-format", `refs/${namespace}/${name}`]).catch(() => { throw new Error("名称包含 Git 不允许的字符"); });
  return name;
}
export async function applyHistoryAction(cwd: string, token: string, input: { name?: string; message?: string; mainline?: number; mode?: "soft" | "mixed" | "hard" }) {
  const preview = previews.get(token);
  if (!preview || preview.cwd !== cwd || preview.expires < Date.now()) throw new Error("操作预览已过期，请重新打开菜单");
  if (running.has(cwd)) throw new Error("当前工作区已有 Git 操作正在执行");
  running.add(cwd);
  try {
    const current = await historyHead(cwd);
    if (current.head !== preview.head || current.branch !== preview.branch) throw new Error("当前分支或 HEAD 已变化，请重新打开操作");
    let summary: string;
    let backupRef: string | undefined;
    switch (preview.action) {
      case "drop": {
        backupRef = await rewriteHistory(cwd, { ...preview, action: "drop" });
        summary = `已丢弃提交，恢复分支：${backupRef}`;
        break;
      }
      case "reword": {
        if (!input.message?.trim()) throw new Error("请填写提交说明");
        backupRef = await rewriteHistory(cwd, { ...preview, message: input.message.trim(), action: "reword" });
        summary = `已修改提交说明，恢复分支：${backupRef}`;
        break;
      }
      case "reset": {
        if (!preview.branch) throw new Error("当前处于分离 HEAD，无法重置当前分支");
        await requireCleanHistoryWorktree(cwd);
        const mode = input.mode ?? "mixed";
        if (!["soft", "mixed", "hard"].includes(mode)) throw new Error("无效重置模式");
        backupRef = await createHistoryBackup(cwd, preview.head);
        await git(cwd, ["reset", `--${mode}`, preview.hash]);
        summary = `已重置到 ${preview.hash.slice(0, 8)}（${mode}），恢复分支：${backupRef}`;
        break;
      }
      case "cherry-pick": {
        await requireCleanHistoryWorktree(cwd);
        const parents = (await git(cwd, ["show", "-s", "--format=%P", preview.hash])).trim().split(" ").filter(Boolean);
        if (parents.length > 1 && (!input.mainline || input.mainline > parents.length)) throw new Error("请选择合并提交的主线父提交");
        try {
          await git(cwd, ["cherry-pick", ...(parents.length > 1 ? ["-m", String(input.mainline)] : []), preview.hash]);
        } catch (reason) {
          const marker = (await git(cwd, ["rev-parse", "--git-path", "CHERRY_PICK_HEAD"])).trim();
          if (await access(resolve(cwd, marker)).then(() => true, () => false)) {
            await git(cwd, ["cherry-pick", "--abort"]).catch(() => { throw new Error("拣选失败且自动中止失败，请在终端检查 git status"); });
          }
          throw new Error(`拣选未完成，已保留原分支状态。${String((reason as { stderr?: string }).stderr ?? reason).slice(0, 1500)}`);
        }
        summary = `已拣选 ${preview.hash.slice(0, 8)}`;
        break;
      }
      case "checkout": {
        await requireCleanHistoryWorktree(cwd);
        await git(cwd, ["checkout", "--detach", preview.hash]);
        summary = `已检出 ${preview.hash.slice(0, 8)}（分离 HEAD）`;
        break;
      }
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
    return { summary, backupRef };
  } finally { running.delete(cwd); }
}
export function registerHistoryActions(server: PluginServerContext) {
  server.handle(historyActionPreviewRpc, async ({ workspaceId, hash, action }, { paseo }) => prepareHistoryAction(await workspaceGitDirectory(paseo, workspaceId), hash, action));
  server.handle(historyActionApplyRpc, async ({ workspaceId, token, ...input }, { paseo }) => applyHistoryAction(await workspaceGitDirectory(paseo, workspaceId), token, input));
}
