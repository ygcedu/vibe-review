import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface FileSnapshot {
  root: string;
  cwd: string;
  paths: Set<string>;
}

export interface NewFileDiff {
  absolutePath: string;
  diff: string;
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
      const absolutePath = join(snapshot.root, relativePath);
      try {
        if (!lstatSync(absolutePath).isFile()) continue;
      } catch {
        continue;
      }
      const content = readFileSync(absolutePath);
      if (content.includes(0)) continue;
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
      files.push({ absolutePath, diff });
    }
    return files;
  } catch (error) {
    console.warn("[vibe-review] cannot inspect new workspace files:", error);
    return [];
  }
}

export function absoluteEditPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
}
