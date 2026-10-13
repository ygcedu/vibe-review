import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommitProposal } from "./pi-commit.ts";
import { atomicWriteJson } from "./atomic-write.ts";

function recordPath(agentId: string): string {
  const id = createHash("sha256").update(agentId).digest("hex");
  return join(tmpdir(), `vibe-review-pi-proposal-${id}.json`);
}

export async function loadCommitProposal(agentId: string, proposalId?: string): Promise<CommitProposal | undefined> {
  const path = recordPath(agentId);
  let proposal: CommitProposal;
  try {
    proposal = JSON.parse(await readFile(path, "utf8")) as CommitProposal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (proposal.agentId !== agentId || typeof proposal.id !== "string" || typeof proposal.expiresAt !== "number") {
    throw new Error("保存的 Pi 提交预览记录无效。");
  }
  if (Date.now() > proposal.expiresAt) {
    await rm(path, { force: true });
    return undefined;
  }
  return proposalId === undefined || proposal.id === proposalId ? proposal : undefined;
}

export async function saveCommitProposal(proposal: CommitProposal): Promise<void> {
  await atomicWriteJson(recordPath(proposal.agentId), proposal);
}

export async function removeCommitProposal(agentId: string, proposalId: string): Promise<void> {
  if (await loadCommitProposal(agentId, proposalId)) await rm(recordPath(agentId), { force: true });
}
