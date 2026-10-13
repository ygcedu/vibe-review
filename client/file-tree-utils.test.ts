import assert from "node:assert/strict";
import test from "node:test";
import { compactTree, sortTreeNodes } from "./file-tree-utils.ts";

type Folder = { kind: "folder"; name: string; path: string; count: number; children: Node[] };
type Leaf = { kind: "file"; name: string; file: { path: string } };
type Node = Folder | Leaf;

function build(paths: string[]): Node[] {
  const root: Node[] = [];
  const folders = new Map<string, Folder>();
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    let children: Node[] = root;
    let p = "";
    for (const name of parts.slice(0, -1)) {
      p = p ? `${p}/${name}` : name;
      let folder = folders.get(p);
      if (!folder) { folder = { kind: "folder", name, path: p, count: 0, children: [] }; folders.set(p, folder); children.push(folder); }
      folder.count++;
      children = folder.children;
    }
    children.push({ kind: "file", name: parts.at(-1) ?? path, file: { path } });
  }
  sortTreeNodes(root);
  return compactTree(root);
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
