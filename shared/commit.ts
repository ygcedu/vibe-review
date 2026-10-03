import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const preparePiCommitRpc = defineRpc({
  name: "vibe-review.prepare-pi-commit",
  input: z.object({ agentId: z.string(), cwd: z.string(), scoredAt: z.string().optional() }),
  output: z.object({ ok: z.literal(true), summary: z.string() }),
});

export const piCommitStatusRpc = defineRpc({
  name: "vibe-review.pi-commit-status",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    kind: z.enum(["idle", "preparing", "ready", "failed"]),
    stage: z.string(),
    startedAt: z.number().optional(),
    diffReady: z.boolean().optional(),
  }),
});

export const getPendingCommitDiffRpc = defineRpc({
  name: "vibe-review.pending-pi-commit-diff",
  input: z.object({ agentId: z.string() }),
  output: z.object({ diff: z.string() }),
});

export const confirmPiCommitRpc = defineRpc({
  name: "vibe-review.confirm-pi-commit",
  input: z.object({ agentId: z.string(), proposalId: z.string(), message: z.string().trim().min(1).max(80) }),
  output: z.object({ ok: z.literal(true), summary: z.string() }),
});

export const commitPreviewSchema = z.object({
  proposalId: z.string(),
  message: z.string(),
  files: z.array(z.string()),
  promptPreview: z.string().optional(),
});
export const COMMIT_PREVIEW_KIND = "pi-commit-preview";

export const getPiCommitPreviewRpc = defineRpc({
  name: "vibe-review.get-pi-commit-preview",
  input: z.object({ agentId: z.string(), proposalId: z.string() }),
  output: z.object({ diff: z.string(), result: z.string().optional() }),
});

export const cancelPiCommitRpc = defineRpc({
  name: "vibe-review.cancel-pi-commit",
  input: z.object({ agentId: z.string(), proposalId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const commitResultSchema = z.object({ summary: z.string(), ok: z.boolean(), proposalId: z.string().optional() });
export const COMMIT_RESULT_KIND = "pi-commit-result";

export const commitAvailabilityRpc = defineRpc({
  name: "vibe-review.commit-availability",
  input: z.object({ agentId: z.string(), scoredAt: z.string() }),
  output: z.object({ available: z.boolean(), cwd: z.string().optional() }),
});
