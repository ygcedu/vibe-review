import { useCallback, useEffect, useState } from "react";
import { Platform, type View } from "react-native";

/** Pause background polling when a card leaves the viewport; native cards stay active. */
export function useCardVisibility() {
  const [node, setNode] = useState<View | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const ref = useCallback((view: View | null) => setNode(view), []);

  useEffect(() => {
    if (Platform.OS !== "web" || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setIsVisible(entry.isIntersecting);
    }, { rootMargin: "200px" });
    observer.observe(node as unknown as HTMLElement);
    return () => observer.disconnect();
  }, [node]);

  return { ref, isVisible };
}
