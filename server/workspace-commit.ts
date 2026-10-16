import { git, workspaceGitDirectory } from "./git.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { workspaceGitCommitRpc, workspaceGitDiffRpc, workspaceGitPushRpc, workspaceGitTrackRpc, workspaceGitStatusRpc } from "../shared/workspace-commit";

const runFile = promisify(execFile);


async function status(cwd: string) {
  const raw = await git(cwd, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
  return raw.split("\0").filter(Boolean).map((entry) => {
    const code = entry.slice(0, 2);
    return { path: entry.slice(3), status: code, staged: code[0] !== " " && code[0] !== "?", unstaged: code[1] !== " " && code[1] !== "?", untracked: code === "??" };
  });
}

function checkedFile(files: Awaited<ReturnType<typeof status>>, path: string) {
  if (!path || path.startsWith("/") || path.includes("\0") || path.split("/").includes("..")) throw new Error("无效文件路径");
  const file = files.find((file) => file.path === path);
  if (!file) throw new Error("文件状态已变化，请刷新");
  return file;
}

export function registerWorkspaceCommit(server: PluginServerContext) {
  server.handle(workspaceGitStatusRpc, async ({ workspaceId }, { paseo }) => {
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const branch = (await git(cwd, ["branch", "--show-current"])).trim();
    return { files: await status(cwd), branch };
  });
  server.handle(workspaceGitDiffRpc, async ({ workspaceId, path, staged, fullContext }, { paseo }) => {
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const file = checkedFile(await status(cwd), path);
    if (file.untracked) {
      try { return { diff: await git(cwd, ["diff", "--no-index", ...(fullContext ? ["--unified=999999"] : []), "--", "/dev/null", path]) }; }
      catch (error) {
        const result = error as { code?: number; stdout?: string };
        if (result.code === 1) return { diff: result.stdout ?? "" };
        throw error;
      }
    }
    return { diff: await git(cwd, ["diff", "--no-ext-diff", "--no-renames", ...(fullContext ? ["--unified=999999"] : []), ...(staged ? ["--cached"] : []), "--", path]) };
  });
  server.handle(workspaceGitTrackRpc, async ({ workspaceId, paths }, { paseo }) => {
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const current = await status(cwd);
    for (const path of paths) {
      if (!checkedFile(current, path).untracked) throw new Error("只能将未跟踪文件加入 Git");
    }
    await git(cwd, ["add", "--", ...paths]);
    return { ok: true as const };
  });
  server.handle(workspaceGitCommitRpc, async ({ workspaceId, message, paths }, { paseo }) => {
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const current = await status(cwd);
    for (const path of paths) checkedFile(current, path);
    const untracked = paths.filter((path) => current.some((file) => file.path === path && file.untracked));
    if (untracked.length) await git(cwd, ["add", "-N", "--", ...untracked]);
    const summary = (await git(cwd, ["commit", "--only", "-m", message, "--", ...paths])).trim();
    return { summary };
  });
  server.handle(workspaceGitPushRpc, async ({ workspaceId }, { paseo }) => {
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const branch = (await git(cwd, ["branch", "--show-current"])).trim();
    if (!branch) throw new Error("当前工作区没有可推送的分支");
    await runFile("git", ["push"], {
      cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { summary: `已推送 ${branch}` };
  });
}
