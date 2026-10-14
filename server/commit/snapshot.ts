import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeSnapshot {
  cwd: string;
  repoRoot: string;
  tree: string;
  tempDir: string;
  objectDir: string;
  repoObjects: string;
}

async function git(cwd: string, args: string[], snapshot?: Pick<WorktreeSnapshot, "objectDir" | "repoObjects">, indexFile?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      ...(snapshot ? { GIT_OBJECT_DIRECTORY: snapshot.objectDir, GIT_ALTERNATE_OBJECT_DIRECTORIES: snapshot.repoObjects } : {}),
      ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

/** Capture non-ignored files with a private index and object store. */
export async function captureWorktree(cwd: string, previous?: WorktreeSnapshot): Promise<WorktreeSnapshot> {
  const repoRoot = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (previous && (previous.cwd !== cwd || previous.repoRoot !== repoRoot)) throw new Error("Workspace changed during the turn");
  const tempDir = previous?.tempDir ?? await mkdtemp(join(tmpdir(), "vibe-review-snapshot-"));
  const objectDir = previous?.objectDir ?? join(tempDir, "objects");
  const repoObjects = previous?.repoObjects ?? await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]);
  const indexDir = await mkdtemp(join(tempDir, "index-"));
  const indexFile = join(indexDir, "index");
  try {
    await mkdir(objectDir, { recursive: true });
    const storage = { objectDir, repoObjects };
    await git(cwd, ["read-tree", "HEAD"], storage, indexFile);
    await git(cwd, ["add", "-A", "--", "."], storage, indexFile);
    const tree = await git(cwd, ["write-tree"], storage, indexFile);
    return { cwd, repoRoot, tree, tempDir, objectDir, repoObjects };
  } catch (error) {
    if (!previous) await rm(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}

/** The net file contents changed between two turn boundaries, including new/deleted files. */
export async function diffSnapshots(before: WorktreeSnapshot, after: WorktreeSnapshot, fullContext = false): Promise<string> {
  if (before.repoRoot !== after.repoRoot || before.cwd !== after.cwd) {
    throw new Error("Workspace changed during the turn");
  }
  return git(before.cwd, [
    "diff", "--no-ext-diff", "--no-renames", "--no-color", `--unified=${fullContext ? 999999 : 3}`,
    before.tree, after.tree, "--", ".",
  ], before);
}

/** Compare HEAD with a private worktree snapshot without touching the user's index. */
export async function diffHeadToSnapshot(snapshot: WorktreeSnapshot, paths?: string[]): Promise<string> {
  return git(snapshot.cwd, [
    "diff", "--no-ext-diff", "--no-renames", "--no-color", "--unified=3",
    "HEAD", snapshot.tree, "--", ...(paths?.length ? paths : ["."]),
  ], snapshot);
}

export async function changedPathsFromHead(snapshot: WorktreeSnapshot): Promise<string[]> {
  const names = await git(snapshot.cwd, ["diff", "--no-renames", "--name-only", "-z", "HEAD", snapshot.tree, "--", "."], snapshot);
  return names.split("\0").filter(Boolean);
}

export async function disposeSnapshot(snapshot: WorktreeSnapshot): Promise<void> {
  await rm(snapshot.tempDir, { recursive: true, force: true });
}
