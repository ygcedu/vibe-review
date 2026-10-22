import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { git } from "./git.ts";
import { createHistoryBackup, historyHead, requireCleanHistoryWorktree } from "./history-repository.ts";

const run = promisify(execFile);
export async function planHistoryRewrite(cwd: string, hash: string) {
  const current = await historyHead(cwd);
  if (!current.branch) throw new Error("请先检出一个本地分支，再改写提交历史");
  await git(cwd, ["merge-base", "--is-ancestor", hash, current.head]).catch(() => { throw new Error("所选提交不在当前分支历史中"); });
  const parents = (await git(cwd, ["show", "-s", "--format=%P", hash])).trim().split(" ").filter(Boolean);
  const base = parents[0];
  const range = base ? `${base}..${current.head}` : current.head;
  if ((await git(cwd, ["rev-list", "--min-parents=2", range])).trim()) throw new Error("所选提交或后续历史包含合并提交，暂不支持改写这段历史");
  const commits = (await git(cwd, ["rev-list", "--reverse", range])).trim().split("\n").filter(Boolean);
  return { ...current, base, commits };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
export async function rewriteHistory(cwd: string, input: { hash: string; head: string; branch: string; action: "reword"; message: string }) {
  await requireCleanHistoryWorktree(cwd);
  const plan = await planHistoryRewrite(cwd, input.hash);
  if (plan.head !== input.head || plan.branch !== input.branch) throw new Error("当前分支或 HEAD 已变化，请重新打开操作");
  const directory = await mkdtemp(join(tmpdir(), "vibe-history-rewrite-"));
  const worktree = join(directory, "worktree");
  let added = false;
  try {
    await git(cwd, ["worktree", "add", "--detach", worktree, input.head]);
    added = true;
    const todo = plan.commits.map((hash) => `${hash === input.hash ? "reword" : "pick"} ${hash}`).join("\n") + "\n";
    const sequenceEditor = join(directory, "sequence.cjs");
    const messageEditor = join(directory, "message.cjs");
    await writeFile(sequenceEditor, `require('node:fs').writeFileSync(process.argv[2], ${JSON.stringify(todo)});\n`);
    await writeFile(messageEditor, `require('node:fs').writeFileSync(process.argv[2], ${JSON.stringify(input.message + "\n")});\n`);
    try {
      await run("git", ["-c", "rebase.autoStash=false", "rebase", "--interactive", "--no-autosquash", "--no-update-refs", "--no-rebase-merges", "--keep-empty", "--empty=keep", ...(plan.base ? [plan.base] : ["--root"])], {
        cwd: worktree, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SEQUENCE_EDITOR: `${shellQuote(process.execPath)} ${shellQuote(sequenceEditor)}`, GIT_EDITOR: `${shellQuote(process.execPath)} ${shellQuote(messageEditor)}` },
      });
    } catch (reason) {
      throw new Error(`历史改写未完成，当前分支未修改。${String((reason as { stderr?: string }).stderr ?? reason).slice(0, 1500)}`);
    }
    const newHead = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    await requireCleanHistoryWorktree(cwd);
    const current = await historyHead(cwd);
    if (current.head !== input.head || current.branch !== input.branch) throw new Error("当前分支或 HEAD 已变化，已放弃改写结果");
    const backupRef = await createHistoryBackup(cwd, input.head);
    await git(cwd, ["reset", "--keep", newHead]);
    return backupRef;
  } finally {
    if (added) await git(cwd, ["worktree", "remove", "--force", worktree]);
    await rm(directory, { recursive: true, force: true });
  }
}
