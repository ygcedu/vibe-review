import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { gitCommitDetailRpc, gitCommitFileDiffRpc, gitHistoryRpc } from "../shared/git-history";

const runFile = promisify(execFile);
const PAGE_SIZE = 50;
const git = async (cwd: string, args: string[]) => (await runFile("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
const gitConfig = async (cwd: string, key: string) => { try { return (await git(cwd, ["config", "--get", key])).trim(); } catch { return ""; } };

async function directory(paseo: PluginHandlerContext["paseo"], workspaceId: string) {
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new Error("工作区目录不可用");
  await git(workspace.workspaceDirectory, ["rev-parse", "--show-toplevel"]);
  return workspace.workspaceDirectory;
}

const format = "%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e";
function parseCommits(raw: string) {
  return raw.split("\x1e").map((record) => record.trimStart()).filter(Boolean).map((record) => {
    const [hash = "", parents = "", author = "", email = "", date = "", subject = "", refs = ""] = record.split("\x1f");
    return { hash, parents: parents ? parents.split(" ") : [], author, email, date, subject, refs: refs ? refs.split(", ") : [] };
  });
}

async function commitBase(cwd: string, hash: string) {
  if (!/^[0-9a-f]{40,64}$/i.test(hash)) throw new Error("无效提交哈希");
  const ancestry = (await git(cwd, ["rev-list", "--parents", "-n", "1", hash])).trim().split(" ");
  if (ancestry[0] !== hash) throw new Error("提交不存在");
  return ancestry[1] ?? null;
}

async function changedFiles(cwd: string, hash: string, base: string | null) {
  const args = base
    ? ["diff", "--name-status", "--no-renames", "-z", base, hash]
    : ["diff-tree", "--root", "--no-commit-id", "--name-status", "--no-renames", "-r", "-z", hash];
  const parts = (await git(cwd, args)).split("\0").filter(Boolean);
  const files: Array<{ path: string; status: string }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ status: parts[i]!, path: parts[i + 1]! });
  return files;
}

export function registerGitHistory(server: PluginServerContext) {
  server.handle(gitHistoryRpc, async ({ workspaceId, branch, query, skip }, { paseo }) => {
    const cwd = await directory(paseo, workspaceId);
    const branches = (await git(cwd, ["for-each-ref", "--format=%(refname)%09%(refname:short)", "refs/heads", "refs/remotes"])).trim().split("\n").filter(Boolean).map((line) => {
      const [ref = "", name = ""] = line.split("\t");
      return { name, group: ref.startsWith("refs/heads/") ? "local" as const : "remote" as const };
    }).filter((item) => item.name && !item.name.endsWith("/HEAD"));
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
    const cwd = await directory(paseo, workspaceId);
    const base = await commitBase(cwd, hash);
    const message = (await git(cwd, ["show", "-s", "--format=%B", hash])).trim();
    return { message, files: await changedFiles(cwd, hash, base) };
  });
  server.handle(gitCommitFileDiffRpc, async ({ workspaceId, hash, path }, { paseo }) => {
    const cwd = await directory(paseo, workspaceId);
    const base = await commitBase(cwd, hash);
    const files = await changedFiles(cwd, hash, base);
    if (!files.some((file) => file.path === path)) throw new Error("文件不属于该提交");
    const diff = base
      ? await git(cwd, ["diff", "--no-ext-diff", "--no-renames", "--unified=3", base, hash, "--", path])
      : await git(cwd, ["show", "--format=", "--root", "--no-ext-diff", hash, "--", path]);
    return { diff };
  });
}
