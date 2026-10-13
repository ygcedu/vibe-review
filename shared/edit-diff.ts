import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const editFullDiffRpc = defineRpc({
  name: "vibe-review.edit-full-diff",
  input: z.object({ agentId: z.string(), path: z.string(), diff: z.string().max(2_000_000) }),
  output: z.object({ diff: z.string() }),
});
