import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidHash, parseChangedFiles, parseCommits } from "./git-history.ts";

const RS = "\x1e"; // record separator (format 末尾 %x1e)
const US = "\x1f"; // unit separator

// format = %H %P %an %ae %aI %s %D，字段按 US 分隔；refs 为 git %D 原样值（逗号分隔）
const record = (hash: string, parents: string, author: string, email: string, date: string, subject: string, refs = "") =>
  [hash, parents, author, email, date, subject, refs].join(US);

test("parseCommits reads a single normal commit", () => {
  const raw = record("a".repeat(40), "", "author", "a@x.com", "2026-01-01T00:00:00Z", "feat: 标题") + RS;
  assert.deepEqual(parseCommits(raw), [{
    hash: "a".repeat(40), parents: [], author: "author", email: "a@x.com",
    date: "2026-01-01T00:00:00Z", subject: "feat: 标题", refs: [],
  }]);
});

test("parseCommits splits multiple parents and refs with comma-space", () => {
  const raw = [
    record("a", "p1 p2 p3", "", "", "", "merge 标题", "main, release/v2, HEAD -> main"),
    record("b", "", "", "", "", "普通 标题"),
    record("c", "p1", "", "", "", "带 refs", "refs/tags/v1, origin/main"),
  ].join(RS);
  assert.deepEqual(parseCommits(raw), [
    { hash: "a", parents: ["p1", "p2", "p3"], author: "", email: "", date: "", subject: "merge 标题", refs: ["main", "release/v2", "HEAD -> main"] },
    { hash: "b", parents: [], author: "", email: "", date: "", subject: "普通 标题", refs: [] },
    { hash: "c", parents: ["p1"], author: "", email: "", date: "", subject: "带 refs", refs: ["refs/tags/v1", "origin/main"] },
  ]);
});

test("parseCommits tolerates empty and trailing-separator stdout", () => {
  assert.deepEqual(parseCommits(""), []);
  assert.deepEqual(parseCommits(RS), []);
  const one = `h${US}subject only${RS}`;
  assert.equal(parseCommits(one).length, 1);
});

test("parseChangedFiles pairs NUL-separated status and path tokens", () => {
  assert.deepEqual(parseChangedFiles("A\0add.txt\0M\0mod.txt\0D\0gone.txt"), [
    { status: "A", path: "add.txt" },
    { status: "M", path: "mod.txt" },
    { status: "D", path: "gone.txt" },
  ]);
});

test("parseChangedFiles drops dangling status without a path and ignores empty output", () => {
  assert.deepEqual(parseChangedFiles("M\0"), []);
  assert.deepEqual(parseChangedFiles(""), []);
});

test("isValidHash accepts 7-64 lowercase hex chars, rejects shorter, longer, and uppercase", () => {
  assert.equal(isValidHash("abcdef1"), true);
  assert.equal(isValidHash("a".repeat(40)), true);
  assert.equal(isValidHash("a".repeat(64)), true);
  assert.equal(isValidHash("a"), false);
  assert.equal(isValidHash("a".repeat(65)), false);
  assert.equal(isValidHash("GHIJKL1"), false);
  assert.equal(isValidHash("abc def"), false);
  assert.equal(isValidHash(""), false);
});
