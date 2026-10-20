import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const sessionEntry = z.object({ id: z.string(), title: z.string().nullable(), provider: z.string(), model: z.string().nullable(), status: z.string(), updatedAt: z.string(), lastActivityAt: z.string().optional(), requiresAttention: z.boolean().optional(), attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(), pendingPermissionCount: z.number().optional(), archived: z.boolean() });
export type SessionEntry = z.infer<typeof sessionEntry>;
export const sessionHistoryRpc = defineRpc({
  name: "vibe-review.session-history",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ sessions: z.array(sessionEntry) }),
});
export const sessionRenameRpc = defineRpc({
  name: "vibe-review.session-rename",
  input: z.object({ workspaceId: z.string(), agentId: z.string().min(1), title: z.string().trim().min(1).max(200) }),
  output: z.object({ ok: z.literal(true) }),
});
export const sessionDeleteRpc = defineRpc({
  name: "vibe-review.session-delete",
  input: z.object({ workspaceId: z.string(), agentId: z.string().min(1), confirmed: z.literal(true) }),
  output: z.object({ ok: z.literal(true) }),
});

export function orderSessions(sessions: readonly SessionEntry[]): SessionEntry[] {
  return [...sessions].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
}

export const sessionRestoreRpc = defineRpc({
  name: "vibe-review.session-restore",
  input: z.object({ workspaceId: z.string(), agentId: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});
