import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface FileSnapshot {
  root: string;
  cwd: string;
  paths: Set<string>;
}

export interface NewFileDiff {
  absolutePath: string;
  diff: string;
}

function newFileDiff(root: string, relativePath: string): NewFileDiff | null {
  const absolutePath = join(root, relativePath);
  try {
    if (!lstatSync(absolutePath).isFile()) return null;
    const content = readFileSync(absolutePath);
    if (content.includes(0)) return null;
    const text = content.toString("utf8");
    const lines = text ? text.split("\n") : [];
    if (text.endsWith("\n")) lines.pop();
    const diff = [
      `diff --git a/${relativePath} b/${relativePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${relativePath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n");
    return { absolutePath, diff };
  } catch {
    return null;
  }
}

function gitFiles(root: string): Set<string> {
  const output = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return new Set(output.split("\0").filter(Boolean));
}

/** Record files already present before a turn, including pre-existing untracked files. */
export function snapshotFiles(cwd: string): FileSnapshot | null {
  try {
    const root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    return { root, cwd, paths: gitFiles(root) };
  } catch (error) {
    console.warn("[vibe-review] cannot snapshot workspace files:", error);
    return null;
  }
}

/** Capture final contents of files first created during this turn, including shell writes. */
export function newFilesSince(snapshot: FileSnapshot): NewFileDiff[] {
  try {
    const files: NewFileDiff[] = [];
    for (const relativePath of gitFiles(snapshot.root)) {
      if (snapshot.paths.has(relativePath)) continue;
      const file = newFileDiff(snapshot.root, relativePath);
      if (file) files.push(file);
    }
    return files;
  } catch (error) {
    console.warn("[vibe-review] cannot inspect new workspace files:", error);
    return [];
  }
}

/** Recover committed additions when a plugin reload missed this turn's start snapshot. */
export function newFilesFromTurnCommits(cwd: string, timeline: readonly AgentTimelineItem[]): NewFileDiff[] {
  try {
    const root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const lastUserAt = timeline.reduce((acc, item, index) => item.type === "user_message" ? index : acc, -1);
    const hashes = new Set<string>();
    for (const item of timeline.slice(lastUserAt + 1)) {
      if (item.type !== "tool_call" || item.detail.type !== "shell") continue;
      for (const match of item.detail.output?.matchAll(/\[[^\]\n]+ ([0-9a-f]{7,40})\]/g) ?? []) hashes.add(match[1]);
    }
    const paths = new Set<string>();
    for (const hash of hashes) {
      const output = execFileSync("git", ["-C", root, "show", "--pretty=format:", "--name-only", "--diff-filter=A", "-z", hash], { encoding: "utf8" });
      for (const file of output.split("\0").filter(Boolean)) paths.add(file);
    }
    return [...paths].map((file) => newFileDiff(root, file)).filter((file): file is NewFileDiff => file !== null);
  } catch (error) {
    console.warn("[vibe-review] cannot inspect files added by turn commits:", error);
    return [];
  }
}

export function absoluteEditPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
}
