import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { runBranchAction } from "./branch-actions.ts";

test("branch operations use exact refs, reject stale previews and preserve working changes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "branch-actions-"));
  try {
    await git(cwd, ["init", "-b", "main"]);
    await git(cwd, ["config", "user.name", "Test"]); await git(cwd, ["config", "user.email", "test@example.com"]);
    await writeFile(join(cwd, "a.txt"), "initial\n"); await git(cwd, ["add", "."]); await git(cwd, ["commit", "-m", "initial"]);
    const ref = "refs/heads/main";
    const preview = await runBranchAction(cwd, { ref, action: "new", preview: true });
    const expected = { expectedHead: preview.head, expectedTarget: preview.target };
    await runBranchAction(cwd, { ref, action: "new", name: "feature/test", ...expected });
    await git(cwd, ["tag", "feature/test"]);
    await runBranchAction(cwd, { ref: "refs/heads/feature/test", action: "checkout", ...expected });
    assert.equal((await git(cwd, ["branch", "--show-current"])).trim(), "feature/test");
    await writeFile(join(cwd, "a.txt"), "modified\n");
    await assert.rejects(runBranchAction(cwd, { ref, action: "checkout", ...expected }), /未提交改动/);
    const comparison = await runBranchAction(cwd, { ref, action: "working-diff", ...expected });
    assert.ok("diff" in comparison);
    assert.match(comparison.diff, /modified/);
    await assert.rejects(runBranchAction(cwd, { ref, action: "delete", ...expected, expectedTarget: "0".repeat(40) }), /分支已变化/);
    await assert.rejects(runBranchAction(cwd, { ref: "refs/heads/feature/test", action: "delete", ...expected }), /不能删除当前分支/);
    await writeFile(join(cwd, "a.txt"), "initial\n");
    await runBranchAction(cwd, { ref, action: "checkout", ...expected });
    await runBranchAction(cwd, { ref: "refs/heads/feature/test", action: "rename", name: "renamed", ...expected });
    await runBranchAction(cwd, { ref: "refs/heads/renamed", action: "delete", ...expected });
    assert.equal((await git(cwd, ["tag", "--list", "feature/test"])).trim(), "feature/test");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
