import { nextMenuIndex } from "./components/context-menu-model";
import { Linking, Platform } from "react-native";

export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}

/** Desktop-only bridge; native callers receive a no-op cleanup. */
export function bindContextMenuTrigger(target: unknown, open: (point: { x: number; y: number }) => void): () => void {
  if (Platform.OS !== "web" || !target) return () => {};
  const node = target as HTMLElement;
  const context = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    open({ x: event.clientX, y: event.clientY });
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = node.getBoundingClientRect();
    open({ x: bounds.left, y: bounds.bottom });
  };
  node.addEventListener("contextmenu", context);
  node.addEventListener("keydown", key);
  return () => { node.removeEventListener("contextmenu", context); node.removeEventListener("keydown", key); };
}

export function bindMenuKeyboard(target: unknown, close: () => void): () => void {
  if (Platform.OS !== "web" || !target) return () => {};
  const node = target as HTMLElement;
  const previous = document.activeElement as HTMLElement | null;
  const items = () => Array.from(node.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
  const frame = requestAnimationFrame(() => items()[0]?.focus());
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const enabled = items();
    const index = enabled.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
      : nextMenuIndex(enabled.map(() => true), index, event.key === "ArrowDown" ? 1 : -1);
    enabled[next]?.focus();
  };
  node.addEventListener("keydown", key);
  return () => {
    cancelAnimationFrame(frame);
    node.removeEventListener("keydown", key);
    if (previous?.isConnected) previous.focus();
  };
}

/** Listen on the whole button boundary, including enabled/disabled descendants. */
export function bindToolbarTooltip(target: unknown, show: () => void, hide: () => void): () => void {
  if (Platform.OS !== "web" || !target) return () => {};
  const node = target as HTMLElement;
  const blur = (event: FocusEvent) => { if (!node.contains(event.relatedTarget as Node | null)) hide(); };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
  node.addEventListener("mouseenter", show);
  node.addEventListener("mouseleave", hide);
  node.addEventListener("focusin", show);
  node.addEventListener("focusout", blur);
  node.addEventListener("keydown", key);
  return () => {
    node.removeEventListener("mouseenter", show);
    node.removeEventListener("mouseleave", hide);
    node.removeEventListener("focusin", show);
    node.removeEventListener("focusout", blur);
    node.removeEventListener("keydown", key);
  };
}
