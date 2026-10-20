import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const file = z.object({ path: z.string(), status: z.string(), staged: z.boolean(), unstaged: z.boolean(), untracked: z.boolean() });
export const workspaceGitStatusRpc = defineRpc({
  name: "vibe-review.workspace-git-status",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ files: z.array(file), branch: z.string() }),
});
export const workspaceGitDiffRpc = defineRpc({
  name: "vibe-review.workspace-git-diff",
  input: z.object({ workspaceId: z.string(), path: z.string(), staged: z.boolean(), fullContext: z.boolean().optional() }),
  output: z.object({ diff: z.string() }),
});
export const workspaceGitTrackRpc = defineRpc({
  name: "vibe-review.workspace-git-track",
  input: z.object({ workspaceId: z.string(), paths: z.array(z.string()).min(1) }),
  output: z.object({ ok: z.literal(true) }),
});
export const workspaceGitCommitRpc = defineRpc({
  name: "vibe-review.workspace-git-commit",
  input: z.object({ workspaceId: z.string(), message: z.string().trim().min(1), paths: z.array(z.string()).min(1) }),
  output: z.object({ summary: z.string() }),
});
export const workspaceGitPushRpc = defineRpc({
  name: "vibe-review.workspace-git-push",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ summary: z.string() }),
});

export type WorkingFile = z.infer<typeof file>;

export const workspaceGitShelfRpc = defineRpc({
  name: "vibe-review.workspace-git-shelf",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ entries: z.array(z.object({
    id: z.string(), ref: z.string(), message: z.string(), date: z.string(), files: z.array(z.string()),
  })) }),
});
export type ShelfEntry = { id: string; ref: string; message: string; date: string; files: string[] };

export const workspaceGitShelfDiffRpc = defineRpc({
  name: "vibe-review.workspace-git-shelf-diff",
  input: z.object({ workspaceId: z.string(), entryId: z.string(), path: z.string() }),
  output: z.object({ diff: z.string() }),
});

export const workspaceChangeAction = z.enum(["rollback", "delete", "shelve"]);
export type ChangeAction = z.infer<typeof workspaceChangeAction>;
export const workspaceChangePreviewRpc = defineRpc({
  name: "vibe-review.workspace-change-preview",
  input: z.object({ workspaceId: z.string(), paths: z.array(z.string()).min(1), action: workspaceChangeAction }),
  output: z.object({ token: z.string(), paths: z.array(z.string()) }),
});
export const workspaceChangeApplyRpc = defineRpc({
  name: "vibe-review.workspace-change-apply",
  input: z.object({ workspaceId: z.string(), token: z.string(), message: z.string().optional() }),
  output: z.object({ summary: z.string(), undoId: z.string(), warning: z.string().optional() }),
});
export const workspaceChangeUndoRpc = defineRpc({
  name: "vibe-review.workspace-change-undo",
  input: z.object({ workspaceId: z.string(), undoId: z.string() }),
  output: z.object({ summary: z.string() }),
});
export const workspaceSourceRpc = defineRpc({
  name: "vibe-review.workspace-source",
  input: z.object({ workspaceId: z.string(), path: z.string() }),
  output: z.object({ content: z.string(), version: z.string() }),
});
export const workspaceSourceSaveRpc = defineRpc({
  name: "vibe-review.workspace-source-save",
  input: z.object({ workspaceId: z.string(), path: z.string(), content: z.string(), version: z.string() }),
  output: z.object({ version: z.string() }),
});
