/** Minimal read-only shape shared by live SDK rows and persisted timeline data. */
export type TimelineItem = { type: string; kind?: string; data?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pluginData(item: TimelineItem, kind: string): Record<string, unknown> | undefined {
  return item.type === "plugin" && item.kind === kind && isRecord(item.data) ? item.data : undefined;
}
