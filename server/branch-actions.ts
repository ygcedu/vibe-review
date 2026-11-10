import type { PluginServerContext } from "@getpaseo/plugin/server";
import { branchActionRpc, type BranchAction } from "../shared/branch-actions.ts";
import { git, workspaceGitDirectory } from "./git.ts";
import { createHistoryBackup, requireCleanHistoryWorktree } from "./history-repository.ts";

export async function runBranchAction(cwd: string, input: { ref: string; action: BranchAction; name?: string; preview?: boolean; expectedHead?: string; expectedTarget?: string }) {
  const { ref, action } = input;
  if (!/^refs\/(heads|remotes|tags)\/.+/.test(ref)) throw new Error("请选择有效分支或标签");
  await git(cwd, ["check-ref-format", ref]);
  const target = (await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const current = (await git(cwd, ["branch", "--show-current"])).trim();
  const local = ref.startsWith("refs/heads/");
  const name = ref.replace(/^refs\/(heads|remotes|tags)\//, "");
  const isCurrent = local && name === current;
  const result = { head, target, current, summary: "操作完成" };
  if (input.preview) return result;
  if (input.expectedHead !== head || input.expectedTarget !== target) throw new Error("分支已变化，请关闭后重新打开操作");
  if (action === "compare" || action === "working-diff") return { ...result, diff: await git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--stat", target, ...(action === "compare" ? [head] : []), "--"]) + "\n" + await git(cwd, ["diff", "--no-ext-diff", "--no-textconv", target, ...(action === "compare" ? [head] : []), "--"]) };
  if (["rename", "delete", "update", "push"].includes(action) && !local) throw new Error("此操作仅支持本地分支");
  if (["rename", "new"].includes(action)) {
    if (!input.name || input.name.startsWith("-")) throw new Error("请输入有效分支名称");
    await git(cwd, ["check-ref-format", "--branch", input.name]);
  }
  if (action === "new") await git(cwd, ["branch", "--", input.name!, target]);
  else if (action === "rename") await git(cwd, ["branch", "-m", name, input.name!]);
  else if (action === "delete") {
    if (isCurrent) throw new Error("不能删除当前分支");
    await git(cwd, ["branch", "-d", "--", name]);
  } else if (action === "fetch") await git(cwd, ["fetch", "--all"]);
  else if (action === "push") {
    const remote = (await git(cwd, ["config", "--get", `branch.${name}.remote`])).trim();
    const merge = (await git(cwd, ["config", "--get", `branch.${name}.merge`])).trim();
    if (!remote || remote === "." || !merge.startsWith("refs/heads/")) throw new Error("请先为此分支配置远程跟踪分支");
    await git(cwd, ["push", "--", remote, `${ref}:${merge}`]);
  } else {
    await requireCleanHistoryWorktree(cwd);
    if (action === "update") {
      const upstream = (await git(cwd, ["rev-parse", "--symbolic-full-name", `${ref}@{upstream}`])).trim();
      if (!upstream.startsWith("refs/remotes/")) throw new Error("此分支没有远程跟踪分支");
      await git(cwd, ["fetch", "--all"]);
      const next = (await git(cwd, ["rev-parse", upstream])).trim();
      if (isCurrent) await git(cwd, ["merge", "--ff-only", next]);
      else { await git(cwd, ["merge-base", "--is-ancestor", target, next]); await git(cwd, ["update-ref", ref, next, target]); }
    } else if (action === "checkout") {
      if (local) await git(cwd, ["switch", "--", name]);
      else if (ref.startsWith("refs/remotes/")) await git(cwd, ["switch", "--track", ref]);
      else await git(cwd, ["switch", "--detach", target]);
    } else {
      if (!current) throw new Error("请先检出一个本地分支");
      const backup = await createHistoryBackup(cwd, head);
      if (action === "checkout-rebase") {
        if (!local || isCurrent) throw new Error("请选择其他本地分支");
        await git(cwd, ["switch", "--", name]);
      }
      try { await git(cwd, action === "merge" ? ["merge", "--no-edit", target] : ["rebase", action === "checkout-rebase" ? head : target]); }
      catch (error) {
        await git(cwd, [action === "merge" ? "merge" : "rebase", "--abort"]).catch(() => "");
        if (action === "checkout-rebase") await git(cwd, ["switch", "--", current]);
        throw new Error(`操作未完成，已尝试中止；恢复分支：${backup}\n${String(error)}`);
      }
      result.summary = `操作完成 · 恢复分支：${backup}`;
    }
  }
  return result;
}
const activeRepositories = new Set<string>();
export function registerBranchActions(server: PluginServerContext) {
  server.handle(branchActionRpc, async (input, { paseo }) => {
    const cwd = await workspaceGitDirectory(paseo, input.workspaceId);
    const repository = (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    if (activeRepositories.has(repository)) throw new Error("此仓库正在执行分支操作，请稍后重试");
    activeRepositories.add(repository);
    try { return await runBranchAction(cwd, input); }
    finally { activeRepositories.delete(repository); }
  });
}
