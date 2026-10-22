import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, type View } from "react-native";

type TreeNode = { expanded?: boolean; toggle?(): void; check?(): void; onSelect?(): void };

/** Navigate mounted tree rows; arrows select without opening a file or changing checkboxes. */
export function useKeyboardTree(resetKey: string) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = useRef<string | null>(null);
  const nodes = useRef(new Map<string, TreeNode>());
  const cleanup = useRef<() => void>(() => {});
  const select = useCallback((key: string) => { active.current = key; setActiveKey(key); nodes.current.get(key)?.onSelect?.(); }, []);
  useEffect(() => { active.current = null; setActiveKey(null); }, [resetKey]);
  useEffect(() => () => cleanup.current(), []);

  const rootRef = useCallback((view: View | null) => {
    cleanup.current();
    cleanup.current = () => {};
    if (Platform.OS !== "web" || !view) return;
    const root = view as unknown as HTMLElement;
    root.tabIndex = 0;
    root.style.setProperty("outline", "none", "important");
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      event.target.style.setProperty("outline", "none", "important");
      const row = event.target.closest<HTMLElement>("[data-keyboard-tree-key]");
      if (row) select(row.dataset.keyboardTreeKey!);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]')) return;
      const focused = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-keyboard-tree-key]") : null;
      if (event.key === " " && focused) {
        const check = nodes.current.get(focused.dataset.keyboardTreeKey!)?.check;
        if (check) { event.preventDefault(); event.stopPropagation(); check(); }
        return;
      }
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-keyboard-tree-key]"));
      if (!rows.length) return;
      event.preventDefault(); event.stopPropagation();
      const index = focused ? rows.indexOf(focused) : rows.findIndex((row) => row.dataset.keyboardTreeKey === active.current);
      const row = rows[index];
      const entry = row ? nodes.current.get(row.dataset.keyboardTreeKey!) : undefined;
      let next = index;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        next = index < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      } else if (row && entry) {
        if (event.key === "ArrowRight") {
          if (entry.expanded === false) { entry.toggle?.(); return; }
          if (entry.expanded && rows[index + 1]?.dataset.keyboardTreeParent === row.dataset.keyboardTreeKey) next = index + 1;
        } else if (entry.expanded) { entry.toggle?.(); return; }
        else {
          const parent = rows.findIndex((candidate) => candidate.dataset.keyboardTreeKey === row.dataset.keyboardTreeParent);
          if (parent >= 0) next = parent;
        }
      }
      const target = rows[next];
      if (!target) return;
      select(target.dataset.keyboardTreeKey!);
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    root.addEventListener("keydown", keydown);
    root.addEventListener("focusin", focus);
    cleanup.current = () => { root.removeEventListener("keydown", keydown); root.removeEventListener("focusin", focus); };
  }, [select]);

  function bind(view: View | null, key: string, parent: string, entry: TreeNode = {}) {
    if (Platform.OS !== "web") return;
    if (!view) { nodes.current.delete(key); return; }
    const row = view as unknown as HTMLElement;
    row.dataset.keyboardTreeKey = key;
    row.dataset.keyboardTreeParent = parent;
    row.style.setProperty("outline", "none", "important");
    nodes.current.set(key, entry);
  }
  return { activeKey, select, rootRef, bind };
}
