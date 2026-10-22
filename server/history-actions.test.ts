import { compareHistoryWithLocal } from "./history-compare.ts";
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

test("new tag targets selected commit, rejects duplicate or invalid names", async (t) => {
  const { cwd, first, head } = await repository(t);
  const preview = await prepareHistoryAction(cwd, first, "new-tag");
  await assert.rejects(applyHistoryAction(cwd, preview.token, { name: "--force" }));
  await applyHistoryAction(cwd, preview.token, { name: "v2.0.0" });
  assert.equal((await git(cwd, ["rev-parse", "refs/tags/v2.0.0"])).trim(), first);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), head);
  const duplicate = await prepareHistoryAction(cwd, head, "new-tag");
  await assert.rejects(applyHistoryAction(cwd, duplicate.token, { name: "v2.0.0" }));
  assert.equal((await git(cwd, ["rev-parse", "refs/tags/v2.0.0"])).trim(), first);
});

test("checkout revision detaches HEAD without moving current branch", async (t) => {
  const { cwd, first, head } = await repository(t);
  const preview = await prepareHistoryAction(cwd, first, "checkout");
  await applyHistoryAction(cwd, preview.token, {});
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), first);
  assert.equal((await git(cwd, ["rev-parse", "main"])).trim(), head);
  assert.equal((await git(cwd, ["branch", "--show-current"])).trim(), "");
});

test("checkout blocks dirty worktree both at preview and after preview", async (t) => {
  const { cwd, first, head } = await repository(t);
  const preview = await prepareHistoryAction(cwd, first, "checkout");
  await writeFile(join(cwd, "file.txt"), "dirty\n");
  await assert.rejects(prepareHistoryAction(cwd, first, "checkout"), /未提交改动/);
  await assert.rejects(applyHistoryAction(cwd, preview.token, {}), /未提交改动/);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), head);
});

test("compare with local includes staged and unstaged differences without changing the repository", async (t) => {
  const { cwd, first, head } = await repository(t);
  await writeFile(join(cwd, "file.txt"), "staged change\n");
  await git(cwd, ["add", "file.txt"]);
  await writeFile(join(cwd, "second.txt"), "unstaged change\n");
  const before = await git(cwd, ["status", "--porcelain"]);
  const comparison = await compareHistoryWithLocal(cwd, first);
  assert.deepEqual(comparison.files.map((file) => file.path), ["file.txt", "second.txt"]);
  assert.match((await compareHistoryWithLocal(cwd, first, "second.txt", true)).diff, /unstaged change/);
  await assert.rejects(compareHistoryWithLocal(cwd, first, "../outside"), /比较结果/);
  assert.equal(await git(cwd, ["status", "--porcelain"]), before);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), head);
});

test("cherry-pick applies a selected commit to current branch", async (t) => {
  const { cwd, first, head } = await repository(t);
  await git(cwd, ["checkout", "-b", "destination", first]);
  const preview = await prepareHistoryAction(cwd, head, "cherry-pick");
  await applyHistoryAction(cwd, preview.token, {});
  assert.equal(await git(cwd, ["show", "HEAD:second.txt"]), "second\n");
  assert.equal((await git(cwd, ["branch", "--show-current"])).trim(), "destination");
});

test("conflicting cherry-pick aborts and restores original HEAD and files", async (t) => {
  const { cwd, first } = await repository(t);
  await writeFile(join(cwd, "file.txt"), "source\n");
  await git(cwd, ["commit", "-am", "Source"]);
  const source = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  await git(cwd, ["checkout", "-b", "destination", first]);
  await writeFile(join(cwd, "file.txt"), "destination\n");
  await git(cwd, ["commit", "-am", "Destination"]);
  const before = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const preview = await prepareHistoryAction(cwd, source, "cherry-pick");
  await assert.rejects(applyHistoryAction(cwd, preview.token, {}), /拣选未完成/);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), before);
  assert.equal((await git(cwd, ["status", "--porcelain"])).trim(), "");
  assert.equal(await git(cwd, ["show", "HEAD:file.txt"]), "destination\n");
});

test("reset modes move the branch and preserve a recovery branch", async (t) => {
  for (const mode of ["soft", "mixed", "hard"] as const) {
    const { cwd, first, head } = await repository(t);
    const preview = await prepareHistoryAction(cwd, first, "reset");
    const result = await applyHistoryAction(cwd, preview.token, { mode });
    assert.ok(result.backupRef);
    assert.equal((await git(cwd, ["rev-parse", result.backupRef])).trim(), head);
    assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), first);
    const staged = (await git(cwd, ["diff", "--cached", "--name-only"])).trim();
    assert.equal(staged, mode === "soft" ? "second.txt" : "");
    assert.equal((await git(cwd, ["status", "--porcelain"])).trim(), mode === "soft" ? "A  second.txt" : mode === "mixed" ? "?? second.txt" : "");
  }
});

test("reset refuses detached HEAD and dirty worktree", async (t) => {
  const { cwd, first } = await repository(t);
  await writeFile(join(cwd, "untracked"), "keep");
  await assert.rejects(prepareHistoryAction(cwd, first, "reset"), /未提交改动/);
  await rm(join(cwd, "untracked"));
  await git(cwd, ["checkout", "--detach"]);
  await assert.rejects(prepareHistoryAction(cwd, first, "reset"), /分离 HEAD/);
});

test("edit an older commit message rewrites descendants, preserves files and creates recovery branch", async (t) => {
  const { cwd, first, head } = await repository(t);
  const originalTree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const preview = await prepareHistoryAction(cwd, first, "reword");
  const result = await applyHistoryAction(cwd, preview.token, { message: "Edited initial\n\nFull body" });
  assert.ok(result.backupRef);
  assert.equal((await git(cwd, ["rev-parse", result.backupRef])).trim(), head);
  assert.equal(await git(cwd, ["rev-parse", "HEAD^{tree}"]), originalTree);
  assert.equal((await git(cwd, ["show", "-s", "--format=%B", "HEAD^"])).trim(), "Edited initial\n\nFull body");
  assert.equal((await git(cwd, ["show", "-s", "--format=%s", "HEAD"])).trim(), "Second");
  assert.equal((await git(cwd, ["rev-list", "--count", "HEAD"])).trim(), "2");
  assert.equal((await git(cwd, ["status", "--porcelain"])).trim(), "");
  assert.equal((await git(cwd, ["worktree", "list", "--porcelain"])).match(/^worktree /gm)?.length, 1);
});

test("message editing rejects targets on another branch and dirty worktrees", async (t) => {
  const { cwd, first, head } = await repository(t);
  await git(cwd, ["checkout", "-b", "other", first]);
  await assert.rejects(prepareHistoryAction(cwd, head, "reword"), /不在当前分支/);
  await writeFile(join(cwd, "file.txt"), "dirty\n");
  await assert.rejects(prepareHistoryAction(cwd, first, "reword"), /未提交改动/);
});

test("drop removes a selected commit and its changes, preserving descendants and a recovery branch", async (t) => {
  const { cwd, head } = await repository(t);
  await writeFile(join(cwd, "third.txt"), "third\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", "Third"]);
  const before = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const preview = await prepareHistoryAction(cwd, head, "drop");
  const result = await applyHistoryAction(cwd, preview.token, {});
  assert.ok(result.backupRef);
  assert.equal((await git(cwd, ["rev-parse", result.backupRef])).trim(), before);
  assert.equal((await git(cwd, ["rev-list", "--count", "HEAD"])).trim(), "2");
  assert.equal(await git(cwd, ["show", "HEAD:third.txt"]), "third\n");
  await assert.rejects(git(cwd, ["show", "HEAD:second.txt"]));
});

test("drop can remove HEAD and refuses dropping the sole commit", async (t) => {
  const { cwd, first, head } = await repository(t);
  const preview = await prepareHistoryAction(cwd, head, "drop");
  await applyHistoryAction(cwd, preview.token, {});
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), first);
  const only = await prepareHistoryAction(cwd, first, "drop");
  await assert.rejects(applyHistoryAction(cwd, only.token, {}), /唯一提交/);
});

test("a conflicting drop leaves current history and worktree intact and cleans temporary worktree", async (t) => {
  const { cwd } = await repository(t);
  await writeFile(join(cwd, "file.txt"), "middle\n");
  await git(cwd, ["commit", "-am", "Middle"]);
  const middle = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  await writeFile(join(cwd, "file.txt"), "later\n");
  await git(cwd, ["commit", "-am", "Later"]);
  const before = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const preview = await prepareHistoryAction(cwd, middle, "drop");
  await assert.rejects(applyHistoryAction(cwd, preview.token, {}), /当前分支未修改/);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), before);
  assert.equal((await git(cwd, ["status", "--porcelain"])).trim(), "");
  assert.equal((await git(cwd, ["worktree", "list", "--porcelain"])).match(/^worktree /gm)?.length, 1);
});

test("squash combines selected commit into chosen ancestor with custom message and recovery", async (t) => {
  const { cwd, first, head } = await repository(t);
  const originalTree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const preview = await prepareHistoryAction(cwd, head, "squash");
  assert.equal(preview.squashTargets[0].hash, first);
  const result = await applyHistoryAction(cwd, preview.token, { squashInto: first, message: "Combined\n\nFull body" });
  assert.ok(result.backupRef);
  assert.equal((await git(cwd, ["rev-parse", result.backupRef])).trim(), head);
  assert.equal((await git(cwd, ["rev-list", "--count", "HEAD"])).trim(), "1");
  assert.equal(await git(cwd, ["rev-parse", "HEAD^{tree}"]), originalTree);
  assert.equal((await git(cwd, ["show", "-s", "--format=%B"])).trim(), "Combined\n\nFull body");
});

test("squash can target a nonadjacent ancestor and preserves intervening changes", async (t) => {
  const { cwd, first } = await repository(t);
  await writeFile(join(cwd, "third.txt"), "third\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", "Third"]);
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const originalTree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const preview = await prepareHistoryAction(cwd, head, "squash");
  await applyHistoryAction(cwd, preview.token, { squashInto: first, message: "First and third" });
  assert.equal((await git(cwd, ["rev-list", "--count", "HEAD"])).trim(), "2");
  assert.equal(await git(cwd, ["rev-parse", "HEAD^{tree}"]), originalTree);
  assert.equal((await git(cwd, ["show", "-s", "--format=%s"])).trim(), "Second");
});

test("squash rejects root as source and invalid destination without moving HEAD", async (t) => {
  const { cwd, first, head } = await repository(t);
  await assert.rejects(prepareHistoryAction(cwd, first, "squash"), /根提交/);
  const preview = await prepareHistoryAction(cwd, head, "squash");
  await assert.rejects(applyHistoryAction(cwd, preview.token, { squashInto: head, message: "Invalid" }), /请选择/);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), head);
});

test("merge cherry-pick requires a mainline and applies changes relative to the chosen parent", async (t) => {
  const { cwd, first, head } = await repository(t);
  await git(cwd, ["checkout", "-b", "side", first]);
  await writeFile(join(cwd, "side.txt"), "side\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", "Side"]);
  await git(cwd, ["checkout", "main"]);
  await git(cwd, ["merge", "--no-ff", "side", "-m", "Merge side"]);
  const merge = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  await git(cwd, ["checkout", "-b", "destination", head]);
  const preview = await prepareHistoryAction(cwd, merge, "cherry-pick");
  assert.equal(preview.parents.length, 2);
  await assert.rejects(applyHistoryAction(cwd, preview.token, {}), /主线父提交/);
  await applyHistoryAction(cwd, preview.token, { mainline: 1 });
  assert.equal(await git(cwd, ["show", "HEAD:side.txt"]), "side\n");
  assert.equal(await git(cwd, ["show", "HEAD:second.txt"]), "second\n");
});

test("history rewrite explicitly rejects merge ancestry", async (t) => {
  const { cwd, first } = await repository(t);
  await git(cwd, ["checkout", "-b", "side", first]);
  await writeFile(join(cwd, "side.txt"), "side\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", "Side"]);
  await git(cwd, ["checkout", "main"]);
  await git(cwd, ["merge", "--no-ff", "side", "-m", "Merge"]);
  const before = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  for (const action of ["reword", "drop", "squash"] as const) await assert.rejects(prepareHistoryAction(cwd, first, action), /合并提交/);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), before);
});

test("conflicting nonadjacent squash leaves the original history untouched", async (t) => {
  const { cwd, first } = await repository(t);
  await writeFile(join(cwd, "file.txt"), "middle\n");
  await git(cwd, ["commit", "-am", "Middle"]);
  await writeFile(join(cwd, "file.txt"), "later\n");
  await git(cwd, ["commit", "-am", "Later"]);
  const before = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const preview = await prepareHistoryAction(cwd, before, "squash");
  await assert.rejects(applyHistoryAction(cwd, preview.token, { squashInto: first, message: "Combined" }), /当前分支未修改/);
  assert.equal((await git(cwd, ["rev-parse", "HEAD"])).trim(), before);
  assert.equal((await git(cwd, ["status", "--porcelain"])).trim(), "");
});
