import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const historyAction = z.enum(["new-branch"]);
export type HistoryAction = z.infer<typeof historyAction>;
export const historyActionPreviewRpc = defineRpc({
  name: "vibe-review.history-action-preview",
  input: z.object({ workspaceId: z.string(), hash: z.string().regex(/^[a-f0-9]{40,64}$/), action: historyAction }),
  output: z.object({ token: z.string(), head: z.string(), branch: z.string(), message: z.string() }),
});
export const historyActionApplyRpc = defineRpc({
  name: "vibe-review.history-action-apply",
  input: z.object({ workspaceId: z.string(), token: z.string(), name: z.string().optional(), message: z.string().optional() }),
  output: z.object({ summary: z.string(), backupRef: z.string().optional() }),
});
