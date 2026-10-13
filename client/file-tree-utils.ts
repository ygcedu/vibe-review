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
  const sort = (items: T[]): void => {
    items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
    items.forEach((node) => { if (node.kind === "folder" && node.children) sort(node.children); });
  };
  sort(nodes);
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
    while ((node.children?.length ?? 0) === 1 && node.children?.[0]?.kind === "folder") {
      const child = node.children[0] as T & { path?: string; children?: T[] };
      node.name += `/${child.name}`;
      node.path = child.path;
      node.children = child.children ?? [];
    }
  }
  return nodes;
}
