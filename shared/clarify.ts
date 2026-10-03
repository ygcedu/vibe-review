import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const clarifyRpc = defineRpc({
  name: "clarify-draft",
  input: z.object({ agentId: z.string().min(1), text: z.string().trim().min(1).max(8000) }),
  output: z.object({ status: z.enum(["suggested", "clear", "uncertain"]), suggestion: z.string(), reason: z.string() }),
});
