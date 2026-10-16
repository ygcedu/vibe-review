import { git, workspaceGitDirectory } from "./git.ts";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gitCommitDetailRpc, gitCommitFileDiffRpc, gitHistoryRpc } from "../shared/git-history.ts";

async function gitConfig(cwd: string, key: string): Promise<string> {
  try {
    return (await git(cwd, ["config", "--get", key])).trim();
  } catch {
    return "";
  }
}

const PAGE_SIZE = 50;
const format = "%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e";
export function parseCommits(raw: string) {
  return raw.split("\x1e").map((record) => record.trimStart()).filter(Boolean).map((record) => {
    const [hash = "", parents = "", author = "", email = "", date = "", subject = "", refs = ""] = record.split("\x1f");
    return { hash, parents: parents ? parents.split(" ") : [], author, email, date, subject, refs: refs ? refs.split(", ") : [] };
  });
}

export type ChangedFile = { path: string; status: string };
export function parseChangedFiles(raw: string): ChangedFile[] {
  const parts = raw.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ status: parts[i]!, path: parts[i + 1]! });
  return files;
}

export const isValidHash = (hash: string) => /^[0-9a-f]{7,64}$/.test(hash);
async function commitBase(cwd: string, hash: string) {
  if (!isValidHash(hash)) throw new Error("无效提交哈希");
  const ancestry = (await git(cwd, ["rev-list", "--parents", "-n", "1", hash])).trim().split(" ");
  if (ancestry[0] !== hash) throw new Error("提交不存在");
  return ancestry[1] ?? null;
}

async function changedFiles(cwd: string, hash: string, base: string | null) {
  const args = base
    ? ["diff", "--name-status", "--no-renames", "-z", base, hash]
    : ["diff-tree", "--root", "--no-commit-id", "--name-status", "--no-renames", "-r", "-z", hash];
  return parseChangedFiles(await git(cwd, args));
}

export function registerGitHistory(server: PluginServerContext) {
  server.handle(gitHistoryRpc, async ({ workspaceId, branch, query, skip }, { paseo }) => {
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const branches = (await git(cwd, ["for-each-ref", "--format=%(refname)%09%(upstream:track)", "refs/heads", "refs/remotes", "refs/tags"])).trim().split("\n").filter(Boolean).map((line) => {
      const [ref = "", tracking = ""] = line.split("\t");
      const ahead = Number(tracking.match(/\bahead (\d+)/)?.[1]) || 0;
      const behind = Number(tracking.match(/\bbehind (\d+)/)?.[1]) || 0;
      if (ref.startsWith("refs/heads/")) return { name: ref.slice("refs/heads/".length), group: "local" as const, ahead, behind };
      if (ref.startsWith("refs/tags/")) return { name: ref.slice("refs/tags/".length), group: "tag" as const, ahead: 0, behind: 0 };
      return { name: ref.slice("refs/remotes/".length), group: "remote" as const, ahead: 0, behind: 0 };
    }).filter((item) => item.name && !(item.group === "remote" && item.name.endsWith("/HEAD")));
    if (branch && !branches.some((item) => item.name === branch)) throw new Error("分支不存在，请刷新");
    const currentBranch = (await git(cwd, ["branch", "--show-current"])).trim();
    const [gitUserName, gitUserEmail] = await Promise.all([gitConfig(cwd, "user.name"), gitConfig(cwd, "user.email")]);
    const args = ["log", `--skip=${skip}`, `-n${PAGE_SIZE + 1}`, `--pretty=format:${format}`];
    if (!branch) args.push("--all");
    if (query.trim()) args.push("--regexp-ignore-case", "--fixed-strings", `--grep=${query.trim()}`);
    if (branch) args.push(branch);
    const raw = branches.length ? await git(cwd, args) : "";
    const commits = parseCommits(raw);
    return { commits: commits.slice(0, PAGE_SIZE), hasMore: commits.length > PAGE_SIZE, branches, currentBranch, currentGitUser: { name: gitUserName, email: gitUserEmail } };
  });
  server.handle(gitCommitDetailRpc, async ({ workspaceId, hash }, { paseo }) => {
    if (!isValidHash(hash)) throw new Error("无效提交哈希");
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const base = await commitBase(cwd, hash);
    const message = (await git(cwd, ["show", "-s", "--format=%B", hash])).trim();
    const branchNames = (await git(cwd, ["for-each-ref", `--contains=${hash}`, "--format=%(refname:short)", "refs/heads", "refs/remotes"])).trim().split("\n").filter(Boolean);
    const inHead = await git(cwd, ["merge-base", "--is-ancestor", hash, "HEAD"]).then(() => true, () => false);
    return { message, files: await changedFiles(cwd, hash, base), containingBranches: inHead ? ["HEAD", ...branchNames] : branchNames };
  });
  server.handle(gitCommitFileDiffRpc, async ({ workspaceId, hash, path, fullContext }, { paseo }) => {
    if (!isValidHash(hash)) throw new Error("无效提交哈希");
    const cwd = await workspaceGitDirectory(paseo, workspaceId);
    const base = await commitBase(cwd, hash);
    const files = await changedFiles(cwd, hash, base);
    if (!files.some((file) => file.path === path)) throw new Error("文件不属于该提交");
    const diff = base
      ? await git(cwd, ["diff", "--no-ext-diff", "--no-renames", `--unified=${fullContext ? 999999 : 3}`, base, hash, "--", path])
      : await git(cwd, ["show", "--format=", "--root", "--no-ext-diff", ...(fullContext ? ["--unified=999999"] : []), hash, "--", path]);
    return { diff };
  });
}
