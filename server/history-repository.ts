import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { git } from "./git.ts";

export async function historyHead(cwd: string) {
  return { head: (await git(cwd, ["rev-parse", "--verify", "HEAD"])).trim(), branch: (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"]).catch(() => "")).trim() };
}
export async function requireCleanHistoryWorktree(cwd: string) {
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    const path = (await git(cwd, ["rev-parse", "--git-path", marker])).trim();
    if (await access(resolve(cwd, path)).then(() => true, () => false)) throw new Error("请先完成或中止当前合并、拣选或变基操作");
  }
  if ((await git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"])).trim()) throw new Error("工作区有未提交改动，请先提交或搁置后重试");
}

export async function createHistoryBackup(cwd: string, head: string) {
  const name = `vibe-review-backup/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  await git(cwd, ["branch", "--", name, head]);
  return name;
}

