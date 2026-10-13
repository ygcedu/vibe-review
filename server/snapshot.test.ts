import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureWorktree, diffSnapshots, disposeSnapshot, type WorktreeSnapshot } from "./snapshot.ts";

test("turn snapshots show net changes without altering the user's index", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-review-snapshot-test-"));
  let before: WorktreeSnapshot | undefined;
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    await writeFile(join(cwd, "edited.txt"), "committed\n");
    await writeFile(join(cwd, "deleted.txt"), "remove me\n");
    git("add", ".");
    git("commit", "-qm", "initial");

    await writeFile(join(cwd, "edited.txt"), "preexisting\n");
    before = await captureWorktree(cwd);
    assert.equal(git("status", "--short"), " M edited.txt");

    await writeFile(join(cwd, "edited.txt"), "intermediate\n");
    await writeFile(join(cwd, "edited.txt"), "final\n");
    await writeFile(join(cwd, "new.txt"), "created\n");
    git("rm", "-q", "deleted.txt");
    git("add", ".");
    git("commit", "-qm", "during turn");

    const after = await captureWorktree(cwd, before);
    const diff = await diffSnapshots(before, after);
    assert.match(diff, /-preexisting\n\+final/);
    assert.doesNotMatch(diff, /intermediate|committed/);
    assert.match(diff, /diff --git a\/new\.txt b\/new\.txt/);
    assert.match(diff, /\+created/);
    assert.match(diff, /diff --git a\/deleted\.txt b\/deleted\.txt/);
    assert.equal(git("status", "--short"), "");
  } finally {
    if (before) await disposeSnapshot(before);
    await rm(cwd, { recursive: true, force: true });
  }
});

test("full-context snapshot preserves lines omitted from the card diff", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-review-full-diff-test-"));
  let before: WorktreeSnapshot | undefined;
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "Test"], { cwd });
    const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
    await writeFile(join(cwd, "sample.txt"), original);
    execFileSync("git", ["add", "sample.txt"], { cwd });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd });
    before = await captureWorktree(cwd);
    await writeFile(join(cwd, "sample.txt"), original.replace("line 10", "changed 10"));
    const after = await captureWorktree(cwd, before);
    const compact = await diffSnapshots(before, after);
    const full = await diffSnapshots(before, after, true);
    assert.doesNotMatch(compact, / line 1\n/);
    assert.match(full, / line 1\n/);
    assert.match(full, / line 20(?:\n|$)/);
  } finally {
    if (before) await disposeSnapshot(before);
    await rm(cwd, { recursive: true, force: true });
  }
});
