import assert from "node:assert/strict";
import test from "node:test";
import { buildFileTree, type FileTreeNode } from "./file-tree-utils.ts";

type Folder = Extract<FileTreeNode<{ path: string }>, { kind: "folder" }>;
type Leaf = Extract<FileTreeNode<{ path: string }>, { kind: "file" }>;

function build(paths: string[]) {
  return buildFileTree(paths.map((path) => ({ path })), true);
}

test("sorts folders before files, alphabetically within each", () => {
  const tree = build(["zz.txt", "b/y.ts", "aa.txt", "a/x.ts"]);
  assert.deepEqual(tree.map((node) => node.name), ["a", "b", "aa.txt", "zz.txt"]);
});

test("collapses single-child folder chains into a compound name", () => {
  const tree = build(["a/b/c/leaf.ts"]);
  assert.equal(tree.length, 1);
  const folder = tree[0] as Folder;
  assert.equal(folder.name, "a/b/c");
  assert.equal(folder.path, "a/b/c");
  assert.equal(folder.children.length, 1);
  assert.equal((folder.children[0] as Leaf).name, "leaf.ts");
});

test("keeps sibling folders separate after compact", () => {
  const tree = build(["a/1/x.ts", "a/2/y.ts"]);
  assert.equal(tree.length, 1);
  const folder = tree[0] as Folder;
  assert.equal(folder.name, "a");
  assert.deepEqual(folder.children.map((node) => (node as Folder).name), ["1", "2"]);
});

test("retains original file identity and source index after sorting", () => {
  const files = [{ path: "z.ts", status: "M" }, { path: "a.ts", status: "A" }];
  const tree = buildFileTree(files);
  assert.equal((tree[0] as Leaf).index, 1);
  assert.equal((tree[0] as Leaf).file, files[1]);
  assert.equal((tree[1] as Leaf).index, 0);
});

test("folders retain all descendant files for counts and bulk selection", () => {
  const files = [{ path: "a/b/x.ts" }, { path: "a/c/y.ts" }];
  const folder = buildFileTree(files, true)[0] as Folder;
  assert.deepEqual(folder.files, files);
  assert.deepEqual((folder.children[0] as Folder).files, [files[0]]);
});

test("keeps folder chains expanded by default and handles an empty tree", () => {
  const folder = buildFileTree([{ path: "a/b/x.ts" }])[0] as Folder;
  assert.equal(folder.name, "a");
  assert.equal((folder.children[0] as Folder).name, "b");
  assert.deepEqual(buildFileTree([]), []);
});
