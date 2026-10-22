import { git } from "./git.ts";

export async function status(cwd: string) {
  const raw = await git(cwd, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
  return raw.split("\0").filter(Boolean).map((entry) => {
    const code = entry.slice(0, 2);
    return { path: entry.slice(3), status: code, staged: code[0] !== " " && code[0] !== "?", unstaged: code[1] !== " " && code[1] !== "?", untracked: code === "??" };
  });
}

export function checkedFile(files: Awaited<ReturnType<typeof status>>, path: string) {
  if (!path || path.startsWith("/") || path.includes("\0") || path.split("/").includes("..")) throw new Error("无效文件路径");
  const file = files.find((file) => file.path === path);
  if (!file) throw new Error("文件状态已变化，请刷新");
  return file;
}

export async function readCommitMessages(cwd: string) {
  const head = await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch((error: unknown) => {
    if ((error as { code?: number }).code === 1) return "";
    throw error;
  });
  if (!head.trim()) return [];
  const raw = await git(cwd, ["log", "-30", "--format=%H%x00%B%x00", "HEAD", "--"]);
  const fields = raw.split("\0");
  const entries: Array<{ hash: string; message: string }> = [];
  for (let i = 0; i + 1 < fields.length; i += 2) entries.push({ hash: fields[i].trim(), message: fields[i + 1].trimEnd() });
  return entries;
}

export async function submitWorkspaceCommit(cwd: string, { message, paths, amend, expectedHead }: { message: string; paths: string[]; amend?: boolean; expectedHead?: string }) {
  if (!message.trim()) throw new Error("请填写提交说明");
  if (!amend && !paths.length) throw new Error("请先勾选要提交的文件");
  if (amend) {
    const head = (await git(cwd, ["rev-parse", "--verify", "HEAD"])).trim();
    if (!expectedHead || head !== expectedHead) throw new Error("最近一次提交已变化，请重新勾选追加");
  }
  const current = await status(cwd);
  for (const path of paths) checkedFile(current, path);
  const untracked = paths.filter((path) => current.some((file) => file.path === path && file.untracked));
  if (untracked.length) await git(cwd, ["add", "-N", "--", ...untracked]);
  const summary = (await git(cwd, ["commit", "--only", ...(amend ? ["--amend"] : []), "-m", message, "--", ...paths])).trim();
  return { summary };
}
