import { useEffect, useRef, type ReactNode } from "react";
import { Platform, View } from "react-native";

/** Keep native edit menus in inputs; custom row menus handle their own events. */
export function SidebarSurface({ children }: { children: ReactNode }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    const node = ref.current as unknown as HTMLElement;
    const suppressDefaultMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
    };
    node.addEventListener("contextmenu", suppressDefaultMenu);
    return () => node.removeEventListener("contextmenu", suppressDefaultMenu);
  }, []);
  return <View ref={ref} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{children}</View>;
}
