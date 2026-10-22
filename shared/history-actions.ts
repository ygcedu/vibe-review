import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const historyAction = z.enum(["new-branch", "new-tag", "checkout", "cherry-pick", "reset", "reword", "drop", "squash"]);
export type HistoryAction = z.infer<typeof historyAction>;
export const historyActionPreviewRpc = defineRpc({
  name: "vibe-review.history-action-preview",
  input: z.object({ workspaceId: z.string(), hash: z.string().regex(/^[a-f0-9]{40,64}$/), action: historyAction }),
  output: z.object({ token: z.string(), head: z.string(), branch: z.string(), message: z.string(), parents: z.array(z.string()), squashTargets: z.array(z.object({ hash: z.string(), message: z.string() })) }),
});
export const historyActionApplyRpc = defineRpc({
  name: "vibe-review.history-action-apply",
  input: z.object({ workspaceId: z.string(), token: z.string(), name: z.string().optional(), message: z.string().optional(), mainline: z.number().int().positive().optional(), mode: z.enum(["soft", "mixed", "hard"]).optional(), squashInto: z.string().regex(/^[a-f0-9]{40,64}$/).optional() }),
  output: z.object({ summary: z.string(), backupRef: z.string().optional() }),
});
