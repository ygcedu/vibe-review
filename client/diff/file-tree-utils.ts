/**
 * Shared traversal helpers for the three file trees (file-tree,
 * workspace-commit, git-history). Each caller keeps its own node types
 * (per-folder payload differs: count vs files vs none) but the
 * folder-before-file sort and single-child-folder collapsing are
 * identical, so they live here.
 *
 * The node constraint only names the fields the algorithm reads.
 * `path`/`children` are optional because leaf (file/branch) nodes in
 * each caller's union don't carry them.
 */

type SortableNode<T> = {
  kind: string;
  name: string;
  path?: string;
  children?: T[];
};

/** Folder-before-file, name-localeCompare order, applied recursively. */
export function sortTreeNodes<T extends SortableNode<T>>(nodes: T[]): void {
  nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
  for (const node of nodes) {
    if (node.kind === "folder" && node.children) sortTreeNodes(node.children);
  }
}

/**
 * Collapse folder chains that contain a single child folder so `a/b/c/`
 * renders as `a/b/c` instead of three nested rows. Mutates in place;
 * returns the same array so callers can use it as a value.
 */
export function compactTree<T extends SortableNode<T>>(nodes: T[]): T[] {
  for (const node of nodes) {
    if (node.kind !== "folder" || !node.children) continue;
    compactTree(node.children);
    while (node.children?.length === 1 && node.children[0].kind === "folder") {
      const child: T = node.children[0];
      node.name += `/${child.name}`;
      node.path = child.path;
      node.children = child.children ?? [];
    }
  }
  return nodes;
}

export type FileTreeNode<T> =
  | { kind: "folder"; name: string; path: string; files: T[]; children: FileTreeNode<T>[] }
  | { kind: "file"; name: string; file: T; index: number };

/** Keep source indices for diff selection and descendant files for folder selection. */
export function buildFileTree<T extends { path: string }>(files: readonly T[], compact = false): FileTreeNode<T>[] {
  const root: FileTreeNode<T>[] = [];
  const folders = new Map<string, Extract<FileTreeNode<T>, { kind: "folder" }>>();

  files.forEach((file, index) => {
    const parts = file.path.split("/").filter(Boolean);
    let children = root;
    let path = "";
    for (const name of parts.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: "folder", name, path, files: [], children: [] };
        folders.set(path, folder);
        children.push(folder);
      }
      folder.files.push(file);
      children = folder.children;
    }
    children.push({ kind: "file", name: parts.at(-1) ?? file.path, file, index });
  });

  sortTreeNodes(root);
  return compact ? compactTree(root) : root;
}
