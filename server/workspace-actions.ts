import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, unlink, writeFile, chmod } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { git as runGit } from "./git.ts";
import type { ChangeAction } from "../shared/workspace-commit.ts";

type Snapshot = { path: string; content: string | null; mode: number; index: string; status: string };
type Plan = { cwd: string; action: ChangeAction; files: Snapshot[]; expires: number };
type Backup = { cwd: string; before: Snapshot[]; after: Snapshot[]; shelf?: string };
const git = (cwd: string, args: string[]) => runGit(cwd, ["--literal-pathspecs", ...args]);
const plans = new Map<string, Plan>();
const locks = new Set<string>();
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
async function pathInProject(cwd: string, path: string) {
  if (!path || isAbsolute(path) || path.includes("\\") || path.includes("\0") || /[\r\n]/.test(path) || path.split("/").some((part) => part === ".." || part === ".git")) throw new Error("无效文件路径");
  const target = resolve(cwd, path);
  const root = await realpath(cwd);
  let ancestor = dirname(target);
  let parent: string;
  for (;;) {
    try { parent = await realpath(ancestor); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error; ancestor = dirname(ancestor); }
  }
  const local = relative(root, parent);
  if (local === ".." || local.startsWith("../") || isAbsolute(local)) throw new Error("文件路径超出工作区");
  try { const stat = await lstat(target); if (!stat.isFile()) throw new Error("仅支持普通文件，不支持符号链接或目录"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return target;
}
async function snapshot(cwd: string, path: string): Promise<Snapshot> {
  const target = await pathInProject(cwd, path);
  let content: string | null = null;
  let mode = 0o644;
  try {
    const stat = await lstat(target);
    if (stat.size > 32 * 1024 * 1024) throw new Error("文件超过 32 MB，无法保留恢复副本");
    content = (await readFile(target)).toString("base64"); mode = stat.mode & 0o777;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { path, content, mode, index: await git(cwd, ["ls-files", "--stage", "-z", "--", path]), status: await git(cwd, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", path]) };
}
async function unchanged(cwd: string, files: Snapshot[]) {
  for (const file of files) if (JSON.stringify(await snapshot(cwd, file.path)) !== JSON.stringify(file)) throw new Error("文件或暂存区已变化，请重新确认操作");
}
async function backupPath(cwd: string, id: string) {
  if (!/^[\da-f-]{36}$/.test(id)) throw new Error("无效恢复记录");
  const dir = resolve(cwd, (await git(cwd, ["rev-parse", "--git-path", "vibe-review/backups"])).trim());
  await mkdir(dir, { recursive: true });
  return join(dir, `${id}.json`);
}
export async function prepareChange(cwd: string, action: ChangeAction, paths: string[]) {
  for (const [token, plan] of plans) if (plan.expires < Date.now()) plans.delete(token);
  const files = await Promise.all([...new Set(paths)].map((path) => snapshot(cwd, path)));
  for (const file of files) {
    if (!file.status) throw new Error(`文件状态已变化：${file.path}`);
    if (file.index.split("\0").filter(Boolean).some((entry) => !/^\d+ [\da-f]+ 0\t/.test(entry))) throw new Error("请先解决合并冲突");
    if (action === "delete" && file.content === null) throw new Error(`文件已删除：${file.path}`);
  }
  const token = randomUUID();
  plans.set(token, { cwd, action, files, expires: Date.now() + 5 * 60_000 });
  return { token, paths: files.map((file) => file.path) };
}
async function patchFor(cwd: string, files: Snapshot[]) {
  let hasHead = true;
  try { await git(cwd, ["rev-parse", "--verify", "HEAD"]); } catch { hasHead = false; }
  const parts: string[] = [];
  for (const file of files) {
    let patch: string;
    if (hasHead && !file.status.startsWith("??") && !file.status.startsWith("A")) patch = await git(cwd, ["diff", "--no-ext-diff", "--no-renames", "--binary", "HEAD", "--", file.path]);
    else {
      try { patch = await git(cwd, ["diff", "--no-index", "--binary", "--", "/dev/null", file.path]); }
      catch (error) { if ((error as { code?: number }).code !== 1) throw error; patch = (error as { stdout: string }).stdout; }
    }
    if (patch) parts.push(`Index: ${file.path}\n${patch}`);
  }
  return parts.join("\n");
}
export async function applyChange(cwd: string, token: string, message?: string) {
  const plan = plans.get(token);
  if (!plan || plan.cwd !== cwd || plan.expires < Date.now()) throw new Error("确认已过期，请重新操作");
  if (locks.has(cwd)) throw new Error("工作区正在执行操作，请稍后重试");
  locks.add(cwd);
  try {
    await unchanged(cwd, plan.files);
    const undoId = randomUUID();
    const record: Backup = { cwd, before: plan.files, after: [] };
    const backup = await backupPath(cwd, undoId);
    await writeFile(backup, JSON.stringify(record), { mode: 0o600 });
    if (plan.action === "shelve") {
      const patch = await patchFor(cwd, plan.files);
      if (!patch) throw new Error("所选文件没有可搁置的工作区差异");
      const id = `vibe-${Date.now()}-${randomUUID()}`;
      const dir = join(cwd, ".idea", "shelf", id);
      await mkdir(dir, { recursive: true });
      const localDir = relative(await realpath(cwd), await realpath(dir));
      if (localDir === ".." || localDir.startsWith("../") || isAbsolute(localDir)) throw new Error("Shelf 目录超出工作区");
      await writeFile(join(dir, "shelved.patch"), patch);
      record.shelf = join(cwd, ".idea", "shelf", `${id}.xml`);
      await writeFile(record.shelf, `<changelist name="${id}" date="${Date.now()}" recycled="false"><option name="PATH" value="$PROJECT_DIR$/.idea/shelf/${id}/shelved.patch" /><option name="DESCRIPTION" value="${escapeXml(message?.trim() || "搁置的更改")}" /></changelist>`);
    }
    await unchanged(cwd, plan.files);
    plans.delete(token);
    let warning: string | undefined;
    try {
      for (const file of plan.files) {
        if (plan.action === "delete") { await unlink(await pathInProject(cwd, file.path)); continue; }
        let inHead = true;
        try { await git(cwd, ["cat-file", "-e", `HEAD:${file.path}`]); } catch { inHead = false; }
        if (inHead) await git(cwd, ["restore", "--source=HEAD", "--staged", "--worktree", "--", file.path]);
        else {
          await git(cwd, ["update-index", "--force-remove", "--", file.path]);
          if (file.content !== null) await unlink(await pathInProject(cwd, file.path));
        }
      }
    } catch (error) {
      warning = `操作中断：${String(error)}。可点击撤销恢复操作前的状态。`;
    } finally {
      record.after = await Promise.all(plan.files.map((file) => snapshot(cwd, file.path)));
      await writeFile(backup, JSON.stringify(record), { mode: 0o600 });
    }
    return { undoId, warning, summary: warning ? "操作未全部完成，恢复副本已保留" : `${plan.action === "delete" ? "已删除" : plan.action === "rollback" ? "已回滚" : "已搁置"} ${plan.files.length} 个文件` };
  } finally { locks.delete(cwd); }
}
export async function undoChange(cwd: string, id: string) {
  if (locks.has(cwd)) throw new Error("工作区正在执行操作，请稍后重试");
  locks.add(cwd);
  try {
    const backup = await backupPath(cwd, id);
    const record = JSON.parse(await readFile(backup, "utf8")) as Backup;
    if (record.cwd !== cwd || !record.after.length) throw new Error("恢复记录不可用");
    await unchanged(cwd, record.after);
    for (const file of record.before) {
      const target = await pathInProject(cwd, file.path);
      if (file.content === null) { try { await unlink(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
      else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, Buffer.from(file.content, "base64")); await chmod(target, file.mode); }
      const match = /^(\d+) ([\da-f]+) 0\t/.exec(file.index);
      if (match) await git(cwd, ["update-index", "--add", "--cacheinfo", `${match[1]},${match[2]},${file.path}`]);
      else await git(cwd, ["update-index", "--force-remove", "--", file.path]);
    }
    record.after = [];
    await writeFile(backup, JSON.stringify(record), { mode: 0o600 });
    return { summary: "已恢复操作前的文件和暂存区" };
  } finally { locks.delete(cwd); }
}
export async function readSource(cwd: string, path: string) {
  const target = await pathInProject(cwd, path);
  if ((await lstat(target)).size > 2 * 1024 * 1024) throw new Error("源码编辑仅支持 2 MB 以内的文本文件");
  const data = await readFile(target);
  if (data.includes(0)) throw new Error("二进制文件无法在源码编辑器中打开");
  return { content: data.toString("utf8"), version: digest(data) };
}
export async function saveSource(cwd: string, path: string, content: string, version: string) {
  const current = await readSource(cwd, path);
  if (current.version !== version) throw new Error("文件已被外部修改，请重新打开后编辑");
  await writeFile(await pathInProject(cwd, path), content);
  return { version: digest(content) };
}
