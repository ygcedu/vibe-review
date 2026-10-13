import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Review result shown as a plugin timeline row. */
export const reviewResultSchema = z.object({
  verdict: z.enum(["pass", "review", "reject"]),
  completed: z.number(),
  drift: z.enum(["in_scope", "minor_drift", "major_drift"]),
  summary: z.string(),
  scoredAt: z.string(),
  processing: z.boolean().optional(),
  turnId: z.string().optional(),
  goal: z.string().optional(),
  result: z.enum(["done", "partial", "none", "unknown"]).optional(),
  taskType: z.enum(["verification_required", "simple_reply", "other"]).optional(),
  verification: z.object({
    status: z.enum(["passed", "failed", "unavailable"]),
    summary: z.string(),
    evidence: z.array(z.string()),
    provider: z.string(),
    cases: z.array(z.object({ name: z.string(), steps: z.array(z.string()), expected: z.string(), actual: z.string(), status: z.enum(["passed", "failed", "blocked"]) })).optional(),
  }).optional(),
  verificationState: z.enum(["running", "canceled", "complete"]).optional(),
  verificationStage: z.string().optional(),
  verificationAgentId: z.string().optional(),
  drifts: z.array(z.string()).optional(),
  narrative: z.string().optional(),
  followups: z.array(z.string()).max(3).optional(),
  /** 发给大模型的审核提示词（已去掉 diff 原文），展开时供调试查看。 */
  detail: z.string().optional(),
  /** 本轮工作树快照的净变更；缺失起点快照时省略。 */
  diff: z.string().optional(),
  /** 轮次结束时的完整上下文差异，用于展开评估卡片中的省略区。 */
  fullDiff: z.string().optional(),
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

export const cancelVerificationRpc = defineRpc({
  name: "vibe-review.cancel-verification",
  input: z.object({ agentId: z.string(), scoredAt: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const reconcileVerificationRpc = defineRpc({
  name: "vibe-review.reconcile-verification",
  input: z.object({ agentId: z.string(), scoredAt: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const openVerificationRpc = defineRpc({
  name: "vibe-review.open-verification",
  input: z.object({ agentId: z.string(), scoredAt: z.string() }),
  output: z.object({ verifierAgentId: z.string(), workspaceId: z.string() }),
});
