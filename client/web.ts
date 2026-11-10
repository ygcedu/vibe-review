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

/** Modal portals sit outside the sidebar DOM, so suppress their native menu too. */
export function bindContextMenuOverlay(target: unknown, close: () => void): () => void {
  if (Platform.OS !== "web" || !target) return () => {};
  const node = target as HTMLElement;
  const context = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const menu = node.querySelector('[role="menu"]');
    if (!menu?.contains(event.target as Node)) close();
  };
  node.addEventListener("contextmenu", context, true);
  return () => node.removeEventListener("contextmenu", context, true);
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

/** Render outside clipped panels without capturing pointer events or keyboard focus. */
export function mountToolbarTooltip(target: unknown, label: string, background: string, foreground: string): () => void {
  if (Platform.OS !== "web" || !target) return () => {};
  const anchor = target as HTMLElement;
  const doc = anchor.ownerDocument;
  const viewport = doc.defaultView;
  if (!viewport) return () => {};
  const tooltip = doc.createElement("div");
  tooltip.setAttribute("role", "tooltip");
  tooltip.textContent = label;
  Object.assign(tooltip.style, {
    position: "fixed", zIndex: "2147483647", pointerEvents: "none",
    boxSizing: "border-box", width: "max-content", padding: "6px 8px",
    borderRadius: "5px", backgroundColor: background, color: foreground,
    fontFamily: "inherit", fontSize: "12px", lineHeight: "16px",
    textAlign: "center", whiteSpace: "normal", overflowWrap: "anywhere",
    boxShadow: "0 2px 8px #0003",
  });
  doc.body.appendChild(tooltip);
  const position = () => {
    const rect = anchor.getBoundingClientRect();
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    tooltip.style.maxWidth = `${Math.max(0, Math.min(240, width - 16))}px`;
    const bounds = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + (rect.width - bounds.width) / 2, width - bounds.width - 8));
    const preferredTop = rect.top - bounds.height - 6;
    const top = preferredTop >= 8 ? preferredTop : rect.bottom + 6;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, Math.min(top, height - bounds.height - 8))}px`;
  };
  position();
  viewport.addEventListener("resize", position);
  doc.addEventListener("scroll", position, true);
  return () => {
    viewport.removeEventListener("resize", position);
    doc.removeEventListener("scroll", position, true);
    tooltip.remove();
  };
}

/** Same browser-owned 900ms clock as Paseo's status-ring/clock.web.ts. */
export function animateSessionStatusRing(target: unknown): () => void {
  if (Platform.OS !== "web" || !target) return () => {};
  const element = target as HTMLElement;
  const animation = element.animate({ transform: ["rotate(0deg)", "rotate(360deg)"] }, { duration: 900, easing: "linear", iterations: Infinity });
  animation.startTime = 0;
  return () => animation.cancel();
}
