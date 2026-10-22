import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { applyHistoryAction, prepareHistoryAction } from "./history-actions.ts";

async function repository(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-history-actions-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, ["init", "-b", "main"]);
  await git(cwd, ["config", "user.name", "Test"]);
  await git(cwd, ["config", "user.email", "test@example.com"]);
  await git(cwd, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(cwd, "file.txt"), "initial\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", "Initial"]);
  const first = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  await writeFile(join(cwd, "second.txt"), "second\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", "Second"]);
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  return { cwd, first, head };
}

test("new branch targets selected commit and does not switch or change dirty worktree", async (t) => {
  const { cwd, first, head } = await repository(t);
  await writeFile(join(cwd, "file.txt"), "dirty\n");
  const preview = await prepareHistoryAction(cwd, first, "new-branch");
  await applyHistoryAction(cwd, preview.token, { name: "feature/from-history" });
  assert.equal((await git(cwd, ["rev-parse", "feature/from-history"])).trim(), first);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), head);
  assert.equal((await git(cwd, ["branch", "--show-current"])).trim(), "main");
  assert.match(await git(cwd, ["diff"]), /dirty/);
  await assert.rejects(applyHistoryAction(cwd, preview.token, { name: "replayed" }), /过期/);
});

test("invalid and existing names are rejected; changed HEAD invalidates preview", async (t) => {
  const { cwd, first } = await repository(t);
  const preview = await prepareHistoryAction(cwd, first, "new-branch");
  for (const name of ["-f", "HEAD", "bad..name", "bad name", "main"]) await assert.rejects(applyHistoryAction(cwd, preview.token, { name }));
  await git(cwd, ["commit", "--allow-empty", "-m", "Changed"]);
  await assert.rejects(applyHistoryAction(cwd, preview.token, { name: "stale" }), /HEAD 已变化/);
});
