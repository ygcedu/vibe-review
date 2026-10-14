import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { CommitProposal } from "./pi-commit.ts";
import { loadCommitProposal, removeCommitProposal, saveCommitProposal } from "./commit-proposals.ts";

test("a Pi proposal remains readable after its creator releases it", async () => {
  const agentId = randomUUID();
  const proposal: CommitProposal = {
    id: randomUUID(), agentId, cwd: "/tmp/example", head: "abc", message: "fix: example",
    files: ["file.ts"], diff: "diff --git a/file.ts b/file.ts", promptPreview: "prompt",
    expiresAt: Date.now() + 60_000,
  };
  try {
    await saveCommitProposal(proposal);
    assert.deepEqual(await loadCommitProposal(agentId, proposal.id), proposal);
    assert.equal(await loadCommitProposal(agentId, randomUUID()), undefined);
    await removeCommitProposal(agentId, proposal.id);
    assert.equal(await loadCommitProposal(agentId, proposal.id), undefined);
  } finally {
    await removeCommitProposal(agentId, proposal.id);
  }
});
