import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prepareChange, applyChange, undoChange, readSource, saveSource } from "./workspace-actions.ts";
import { readIdeShelf, readIdeShelfDiff } from "./workspace-shelf.ts";

async function fixture(run: (cwd: string, git: (...args: string[]) => string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-actions-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  try {
    git("init"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src/a.txt"), "base\n"); await writeFile(join(cwd, "other.txt"), "base\n");
    git("add", "."); git("commit", "-m", "initial");
    await writeFile(join(cwd, "src/a.txt"), "staged\n"); git("add", "src/a.txt");
    await writeFile(join(cwd, "src/a.txt"), "working\n"); await writeFile(join(cwd, "other.txt"), "unrelated\n");
    await run(cwd, git);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
test("rollback only selected files and undo restores worktree and original index", async () => fixture(async (cwd, git) => {
  const plan = await prepareChange(cwd, "rollback", ["src/a.txt"]);
  const result = await applyChange(cwd, plan.token);
  assert.equal(await readFile(join(cwd, "src/a.txt"), "utf8"), "base\n");
  assert.equal(await readFile(join(cwd, "other.txt"), "utf8"), "unrelated\n");
  await undoChange(cwd, result.undoId);
  assert.equal(await readFile(join(cwd, "src/a.txt"), "utf8"), "working\n");
  assert.equal(git("show", ":src/a.txt"), "staged\n");
}));
test("delete is recoverable and undo refuses to overwrite subsequent edits", async () => fixture(async (cwd) => {
  const plan = await prepareChange(cwd, "delete", ["src/a.txt"]);
  const result = await applyChange(cwd, plan.token);
  await assert.rejects(readFile(join(cwd, "src/a.txt")), /ENOENT/);
  await writeFile(join(cwd, "src/a.txt"), "newer");
  await assert.rejects(undoChange(cwd, result.undoId), /已变化/);
  await rm(join(cwd, "src/a.txt"));
  await undoChange(cwd, result.undoId);
  assert.equal(await readFile(join(cwd, "src/a.txt"), "utf8"), "working\n");
}));
test("shelve writes a readable IDE patch for tracked and untracked paths, then removes only those changes", async () => fixture(async (cwd, git) => {
  await writeFile(join(cwd, "src/中文 file.txt"), "new\n");
  const plan = await prepareChange(cwd, "shelve", ["src/a.txt", "src/中文 file.txt"]);
  const result = await applyChange(cwd, plan.token, '测试 & "说明"');
  const entries = await readIdeShelf(cwd);
  assert.equal(entries[0].message, '测试 & "说明"');
  assert.deepEqual(entries[0].files.sort(), ["src/a.txt", "src/中文 file.txt"].sort());
  const diff = await readIdeShelfDiff(cwd, entries[0].id, "src/a.txt");
  assert.ok(diff.includes("+working"));
  assert.equal(git("status", "--porcelain", "--", "src/a.txt", "src/中文 file.txt"), "");
  const patches = await Promise.all(entries[0].files.map((path) => readIdeShelfDiff(cwd, entries[0].id, path)));
  await writeFile(join(cwd, "verify.patch"), patches.join("\n"));
  git("apply", "--check", "verify.patch");
  await undoChange(cwd, result.undoId);
  assert.equal(await readFile(join(cwd, "src/中文 file.txt"), "utf8"), "new\n");
}));
test("rejects stale plans, traversal, conflicting sources and symlinks", async () => fixture(async (cwd) => {
  const plan = await prepareChange(cwd, "rollback", ["src/a.txt"]);
  await writeFile(join(cwd, "src/a.txt"), "newer\n");
  await assert.rejects(applyChange(cwd, plan.token), /已变化/);
  await assert.rejects(prepareChange(cwd, "delete", ["../outside"]), /无效/);
  await symlink(tmpdir(), join(cwd, "outside"));
  await assert.rejects(prepareChange(cwd, "delete", ["outside/test"]), /超出/);
  const source = await readSource(cwd, "src/a.txt");
  await saveSource(cwd, "src/a.txt", "edited\n", source.version);
  await assert.rejects(saveSource(cwd, "src/a.txt", "overwrite", source.version), /外部修改/);
}));

test("rollback handles deleted files after their parent directory disappears", async () => fixture(async (cwd) => {
  await rm(join(cwd, "src"), { recursive: true });
  const plan = await prepareChange(cwd, "rollback", ["src/a.txt"]);
  const result = await applyChange(cwd, plan.token);
  assert.equal(await readFile(join(cwd, "src/a.txt"), "utf8"), "base\n");
  await undoChange(cwd, result.undoId);
  await assert.rejects(readFile(join(cwd, "src/a.txt")), /ENOENT/);
}));
test("shelving refuses to write through a Shelf directory symlink", async () => fixture(async (cwd) => {
  const outside = await mkdtemp(join(tmpdir(), "vibe-shelf-outside-"));
  try {
    await mkdir(join(cwd, ".idea"));
    await symlink(outside, join(cwd, ".idea", "shelf"));
    const plan = await prepareChange(cwd, "shelve", ["src/a.txt"]);
    await assert.rejects(applyChange(cwd, plan.token), /超出工作区/);
    assert.equal(await readFile(join(cwd, "src/a.txt"), "utf8"), "working\n");
  } finally { await rm(outside, { recursive: true, force: true }); }
}));
