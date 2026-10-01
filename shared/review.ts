import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Review result shown as a plugin timeline row. */
export const reviewResultSchema = z.object({
  verdict: z.enum(["pass", "review", "reject"]),
  completed: z.number(),
  drift: z.enum(["in_scope", "minor_drift", "major_drift"]),
  summary: z.string(),
  scoredAt: z.string(),
  turnId: z.string().optional(),
  goal: z.string().optional(),
  result: z.enum(["done", "partial", "none", "unknown"]).optional(),
  drifts: z.array(z.string()).optional(),
  narrative: z.string().optional(),
  /** 发给大模型的审核提示词（已去掉 diff 原文），展开时供调试查看。 */
  detail: z.string().optional(),
  /** 本轮工具记录的变更片段，卡片展开时渲染为带色 diff。 */
  diff: z.string().optional(),
  diffIncomplete: z.boolean().optional(),
});

/** Timeline renderer contract. */
export const REVIEW_KIND = "review-result";
export const REVIEW_VERSION = 1;

/** Manual trigger from client slash command / command center. */
export const reviewAgentRpc = defineRpc({
  name: "vibe-review.run",
  input: z.object({ agentId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
