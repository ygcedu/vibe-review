import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { readCommitMessages, submitWorkspaceCommit } from "./workspace-submit.ts";

async function repository(t: TestContext, initial = true) {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-submit-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.name", "Test"]);
  await git(cwd, ["config", "user.email", "test@example.com"]);
  await git(cwd, ["config", "commit.gpgsign", "false"]);
  if (initial) {
    await writeFile(join(cwd, "a.txt"), "initial\n");
    await writeFile(join(cwd, "b.txt"), "initial\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Initial\n\nFull body"]);
  }
  return cwd;
}

test("message history includes full bodies and handles an unborn branch", async (t) => {
  const cwd = await repository(t, false);
  assert.deepEqual(await readCommitMessages(cwd), []);
  await writeFile(join(cwd, "new.txt"), "new\n");
  await submitWorkspaceCommit(cwd, { paths: ["new.txt"], message: "Title\n\nBody\nSecond line" });
  const entries = await readCommitMessages(cwd);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, "Title\n\nBody\nSecond line");
  assert.equal(entries[0].hash, (await git(cwd, ["rev-parse", "HEAD"])).trim());
});

test("normal commit only includes selected files and preserves unrelated staging", async (t) => {
  const cwd = await repository(t);
  await writeFile(join(cwd, "a.txt"), "changed a\n");
  await writeFile(join(cwd, "b.txt"), "changed b\n");
  await git(cwd, ["add", "b.txt"]);
  await submitWorkspaceCommit(cwd, { paths: ["a.txt"], message: "Selected" });
  assert.equal((await git(cwd, ["rev-list", "--count", "HEAD"])).trim(), "2");
  assert.equal(await git(cwd, ["show", "HEAD:b.txt"]), "initial\n");
  assert.equal((await git(cwd, ["diff", "--cached", "--name-only"])).trim(), "b.txt");
});

test("message-only amend preserves the tree and unrelated staged changes", async (t) => {
  const cwd = await repository(t);
  const expectedHead = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const tree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
  await writeFile(join(cwd, "b.txt"), "staged\n");
  await git(cwd, ["add", "b.txt"]);
  await submitWorkspaceCommit(cwd, { paths: [], amend: true, expectedHead, message: "Reworded\n\nBody" });
  assert.equal(await git(cwd, ["rev-parse", "HEAD^{tree}"]), tree);
  assert.equal((await git(cwd, ["rev-list", "--count", "HEAD"])).trim(), "1");
  assert.equal((await git(cwd, ["diff", "--cached", "--name-only"])).trim(), "b.txt");
});

test("amend includes selected changes without adding a commit", async (t) => {
  const cwd = await repository(t);
  const expectedHead = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  await writeFile(join(cwd, "new.txt"), "new file\n");
  await submitWorkspaceCommit(cwd, { paths: ["new.txt"], amend: true, expectedHead, message: "Amended" });
  assert.equal((await git(cwd, ["rev-list", "--count", "HEAD"])).trim(), "1");
  assert.equal(await git(cwd, ["show", "HEAD:new.txt"]), "new file\n");
});

test("stale or missing amend target is rejected before staging files", async (t) => {
  const cwd = await repository(t);
  await writeFile(join(cwd, "new.txt"), "new\n");
  for (const expectedHead of [undefined, "0".repeat(40)]) {
    await assert.rejects(submitWorkspaceCommit(cwd, { paths: ["new.txt"], amend: true, expectedHead, message: "Stale" }), /最近一次提交已变化/);
  }
  assert.equal((await git(cwd, ["status", "--porcelain"])).trim(), "?? new.txt");
});
