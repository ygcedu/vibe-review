import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
export const branchAction = z.enum(["checkout", "new", "checkout-rebase", "compare", "working-diff", "rebase", "merge", "update", "push", "rename", "delete", "fetch"]);
export type BranchAction = z.infer<typeof branchAction>;
export const branchActionRpc = defineRpc({
  name: "vibe-review.branch-action",
  input: z.object({ workspaceId: z.string(), ref: z.string(), action: branchAction, name: z.string().optional(), expectedHead: z.string().optional(), expectedTarget: z.string().optional(), preview: z.boolean().optional() }),
  output: z.object({ head: z.string(), target: z.string(), current: z.string(), summary: z.string(), diff: z.string().optional() }),
});
