import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureWorktree, diffSnapshots, disposeSnapshot } from "./snapshot.ts";
import { replaceTurnSnapshot, takeTurnSnapshot } from "./turn-snapshots.ts";

test("turn baseline survives between hook instances", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-review-turn-test-"));
  const agentId = `test-${cwd}`;
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    await writeFile(join(cwd, "file.txt"), "before\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    const stale = await captureWorktree(cwd);
    await replaceTurnSnapshot(agentId, { turnId: "stale-turn", snapshot: stale });
    await replaceTurnSnapshot(agentId, { turnId: "turn-1", snapshot: await captureWorktree(cwd) });
    await assert.rejects(access(stale.tempDir), { code: "ENOENT" });

    await writeFile(join(cwd, "file.txt"), "after\n");
    const started = await takeTurnSnapshot(agentId);
    assert.equal(started?.turnId, "turn-1");
    assert.ok(started);
    const after = await captureWorktree(cwd, started.snapshot);
    assert.match(await diffSnapshots(started.snapshot, after), /-before\n\+after/);
    await disposeSnapshot(started.snapshot);
    assert.equal(await takeTurnSnapshot(agentId), undefined);
  } finally {
    const remaining = await takeTurnSnapshot(agentId);
    if (remaining) await disposeSnapshot(remaining.snapshot);
    await rm(cwd, { recursive: true, force: true });
  }
});
