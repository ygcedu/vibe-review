export type MenuPoint = { x: number; y: number; align?: "end"; aboveY?: number };

export function menuPosition(point: MenuPoint, viewport: { width: number; height: number }, size: { width: number; height: number }) {
  const inset = 8;
  const left = point.align === "end" ? point.x - size.width : point.x;
  const top = point.aboveY !== undefined && point.y + size.height > viewport.height - inset ? point.aboveY - size.height : point.y;
  return {
    left: Math.max(inset, Math.min(left, viewport.width - size.width - inset)),
    top: Math.max(inset, Math.min(top, viewport.height - size.height - inset)),
  };
}

export function nextMenuIndex(enabled: readonly boolean[], current: number, direction: 1 | -1): number {
  for (let step = 1; step <= enabled.length; step++) {
    const index = (current + direction * step + enabled.length) % enabled.length;
    if (enabled[index]) return index;
  }
  return -1;
}
