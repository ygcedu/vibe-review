import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const commit = z.object({ hash: z.string(), parents: z.array(z.string()), author: z.string(), email: z.string(), date: z.string(), subject: z.string(), refs: z.array(z.string()) });
const branch = z.object({ name: z.string(), group: z.enum(["local", "remote", "tag"]), ahead: z.number(), behind: z.number() });
const changedFile = z.object({ path: z.string(), status: z.string() });

export const gitHistoryRpc = defineRpc({
  name: "vibe-review.git-history",
  input: z.object({ workspaceId: z.string(), branch: z.string(), query: z.string(), skip: z.number().int().nonnegative() }),
  output: z.object({ commits: z.array(commit), hasMore: z.boolean(), branches: z.array(branch), currentBranch: z.string(), currentGitUser: z.object({ name: z.string(), email: z.string() }) }),
});
export const gitCommitDetailRpc = defineRpc({
  name: "vibe-review.git-commit-detail",
  input: z.object({ workspaceId: z.string(), hash: z.string() }),
  output: z.object({ message: z.string(), files: z.array(changedFile), containingBranches: z.array(z.string()) }),
});
export const gitCommitFileDiffRpc = defineRpc({
  name: "vibe-review.git-commit-file-diff",
  input: z.object({ workspaceId: z.string(), hash: z.string(), path: z.string(), fullContext: z.boolean().optional() }),
  output: z.object({ diff: z.string() }),
});

export type GitCommit = z.infer<typeof commit>;
export type GitBranch = z.infer<typeof branch>;
export type ChangedFile = z.infer<typeof changedFile>;
