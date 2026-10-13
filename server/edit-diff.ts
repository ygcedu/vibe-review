import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { editFullDiffRpc } from "../shared/edit-diff.ts";

const runFile = promisify(execFile);

/** Rebuild the two file versions in an isolated directory; never apply a patch to the workspace. */
export async function reconstructFullEditDiff(workspaceDirectory: string, path: string, diff: string): Promise<string> {
    const root = await realpath(workspaceDirectory);
    const target = await realpath(resolve(root, path));
    const name = relative(root, target);
    if (!name || name.startsWith(`..${sep}`) || name === ".." || isAbsolute(name) || name.includes("\0")) throw new Error("无效编辑路径");
    const patchBody = diff.trimStart();
    const hasHunksOnly = patchBody.startsWith("@@");
    const hasFileHeaders = patchBody.startsWith(`--- a/${name}\n+++ b/${name}\n`);
    if (!hasHunksOnly && !hasFileHeaders && !patchBody.startsWith(`diff --git a/${name} b/${name}`)) throw new Error("补丁路径与文件不一致");
    const after = await readFile(target);
    if (after.includes(0)) throw new Error("二进制文件不支持展开");
    const temporary = await mkdtemp(join(tmpdir(), "vibe-review-edit-diff-"));
    try {
      const patch = hasHunksOnly ? `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${patchBody.trimEnd()}\n` : hasFileHeaders ? `diff --git a/${name} b/${name}\n${patchBody}` : patchBody;
      const file = join(temporary, name);
      const patchFile = join(temporary, "patch.diff");
      const afterFile = join(temporary, "after.txt");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, after);
      await writeFile(afterFile, after);
      await writeFile(patchFile, patch);
      await runFile("git", ["apply", "--reverse", "--unidiff-zero", "--whitespace=nowarn", patchFile], { cwd: temporary, maxBuffer: 16 * 1024 * 1024 });
      try {
        return (await runFile("git", ["diff", "--no-index", "--no-ext-diff", "--unified=999999", "--", file, afterFile], { cwd: temporary, maxBuffer: 32 * 1024 * 1024 })).stdout;
      } catch (error) {
        const result = error as { code?: number; stdout?: string };
        if (result.code === 1) return result.stdout ?? "";
        throw error;
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
}

export function registerEditDiff(server: PluginServerContext) {
  server.handle(editFullDiffRpc, async ({ agentId, path, diff }, { paseo }) => {
    const agent = (await paseo.agents.ref(agentId).refresh())?.agent;
    if (!agent?.workspaceId) throw new Error("编辑所在工作区不可用");
    const workspace = await paseo.workspaces.ref(agent.workspaceId).refresh();
    if (!workspace?.workspaceDirectory) throw new Error("编辑所在工作区不可用");
    return { diff: await reconstructFullEditDiff(workspace.workspaceDirectory, path, diff) };
  });
}
