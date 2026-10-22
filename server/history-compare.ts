import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gitCompareLocalRpc } from "../shared/git-history.ts";
import { git, workspaceGitDirectory } from "./git.ts";
import { parseChangedFiles } from "./git-history.ts";

export async function compareHistoryWithLocal(cwd: string, hash: string, path?: string, fullContext = false) {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error("无效提交 Hash");
  await git(cwd, ["rev-parse", "--verify", `${hash}^{commit}`]);
  const files = parseChangedFiles(await git(cwd, ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", hash, "--"]));
  if (path !== undefined && !files.some((file) => file.path === path)) throw new Error("文件不在当前比较结果中，请刷新比较");
  const diff = path === undefined ? "" : await git(cwd, ["diff", "--no-ext-diff", "--no-renames", `--unified=${fullContext ? 999999 : 3}`, hash, "--", path]);
  return { files, diff };
}
export function registerHistoryCompare(server: PluginServerContext) {
  server.handle(gitCompareLocalRpc, async ({ workspaceId, hash, path, fullContext }, { paseo }) => compareHistoryWithLocal(await workspaceGitDirectory(paseo, workspaceId), hash, path, fullContext));
}
