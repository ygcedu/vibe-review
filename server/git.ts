import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

const runFile = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runFile("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

export async function workspaceGitDirectory(paseo: PluginHandlerContext["paseo"], workspaceId: string): Promise<string> {
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new Error("工作区目录不可用");
  await git(workspace.workspaceDirectory, ["rev-parse", "--show-toplevel"]);
  return workspace.workspaceDirectory;
}
