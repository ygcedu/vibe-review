import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmPiCommit, hasPendingCodeChanges, piPreviewArgs, preparePiCommit } from "./pi-commit.ts";

const fakePiScript = (message: string, files: string[]) => `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({ type: "agent_start" })}\n${JSON.stringify({ type: "message_start" })}\n${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify({ message, files }) }] } })}\nJSON\n`;

test("Pi receives read-only preview instructions and review context", () => {
  const args = piPreviewArgs({ executable: "pi", provider: "openai", model: "gpt-6" }, "diff", ["file.ts"], "目标：修复问题", "fix: previous change");
  assert.deepEqual(args.slice(0, 12), ["--print", "--mode", "json", "--no-session", "--no-extensions", "--no-tools", "--no-skills", "--no-context-files", "--provider", "openai", "--model", "gpt-6"]);
  assert.match(args.at(-1)!, /只生成预览，绝不执行提交/);
  assert.match(args.at(-1)!, /修复问题/);
  assert.match(args.at(-1)!, /fix: previous change/);
  assert.match(args.at(-1)!, /不要列举文件和功能清单/);
});

test("Pi follows the repository's English conventional commit style", () => {
  const args = piPreviewArgs({ executable: "pi", provider: "", model: "" }, "diff", ["file.ts"], "", "fix: correct layout\nfeat: add preview\nstyle: adjust spacing");
  assert.match(args.at(-1)!, /英文 Conventional Commit/);
});

test("preview prompt keeps the actual instructions while omitting diff content", () => {
  const config = { executable: "pi", provider: "", model: "" };
  const diff = "diff --git a/secret.ts b/secret.ts\n+const value = 42;";
  const actual = piPreviewArgs(config, diff, ["secret.ts"], "目标：修复错误", "fix: previous").at(-1)!;
  const visible = piPreviewArgs(config, diff, ["secret.ts"], "目标：修复错误", "fix: previous", true).at(-1)!;
  assert.match(actual, /const value = 42/);
  assert.doesNotMatch(visible, /const value = 42/);
  assert.match(visible, /diff 内容已省略/);
  assert.match(visible, /目标：修复错误/);
  assert.match(visible, /fix: previous/);
});

test("preview is read-only; confirmation commits only selected files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vibe-review-pi-test-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(join(dir, "file.txt"), "before\n");
    await writeFile(join(dir, "other.txt"), "before\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    await writeFile(join(dir, "file.txt"), "after\n");
    await writeFile(join(dir, "new.txt"), "new\n");
    await writeFile(join(dir, "other.txt"), "staged but unrelated\n");
    git("add", "other.txt");
    const head = git("rev-parse", "HEAD");
    const stub = join(dir, "fake-pi");
    await writeFile(stub, fakePiScript("修复测试文件", ["file.txt", "new.txt"]));
    await chmod(stub, 0o755);
    const stages: string[] = [];
    let candidateDiff = "";
    const proposal = await preparePiCommit("agent-1", dir, { executable: stub, provider: "", model: "" }, "", (stage) => stages.push(stage), (diff) => { candidateDiff = diff; });
    assert.ok(stages.some((stage) => stage.includes("模型已开始响应")));
    assert.match(candidateDiff, /other\.txt/); // Before Pi chooses the submitted subset.
    assert.equal(git("rev-parse", "HEAD"), head);
    assert.match(proposal.diff, /file\.txt/);
    assert.match(proposal.diff, /new\.txt/);
    assert.doesNotMatch(proposal.diff, /other\.txt/);
    assert.match(git("diff", "--cached", "--name-only"), /other\.txt/);
    const summary = await confirmPiCommit(proposal);
    assert.match(summary, /修复测试文件$/);
    assert.match(git("show", "--pretty=format:", "--name-only", "HEAD"), /file\.txt/);
    assert.doesNotMatch(git("show", "--pretty=format:", "--name-only", "HEAD"), /other\.txt/);
    assert.match(git("diff", "--cached", "--name-only"), /other\.txt/);
    await rm(stub);
    await writeFile(join(dir, ".DS_Store"), "metadata");
    assert.equal(await readFile(join(dir, "new.txt"), "utf8"), "new\n");
    assert.equal(await hasPendingCodeChanges(dir), true); // unrelated staged file remains
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("changed worktree invalidates confirmation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vibe-review-pi-test-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(join(dir, "file.txt"), "before\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    await writeFile(join(dir, "file.txt"), "after\n");
    const stub = join(dir, "fake-pi");
    await writeFile(stub, fakePiScript("修改文件", ["file.txt"]));
    await chmod(stub, 0o755);
    const proposal = await preparePiCommit("agent-1", dir, { executable: stub, provider: "", model: "" });
    await writeFile(join(dir, "file.txt"), "changed again\n");
    await assert.rejects(confirmPiCommit(proposal), /文件内容已变化/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Pi model errors are reported instead of JSON parse errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vibe-review-pi-error-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(join(dir, "file.txt"), "before\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    await writeFile(join(dir, "file.txt"), "after\n");
    const stub = join(dir, "fake-pi");
    await writeFile(stub, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "provider unavailable", content: [] } })}\nJSON\n`);
    await chmod(stub, 0o755);
    await assert.rejects(preparePiCommit("agent-1", dir, { executable: stub, provider: "", model: "" }), /Pi 模型响应失败：provider unavailable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
