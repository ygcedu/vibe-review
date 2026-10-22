export type HistoryColumnWidths = [number, number, number, number];
export const HISTORY_COLUMN_MINIMUMS: HistoryColumnWidths = [48, 120, 88, 64];
export const HISTORY_TABLE_CHROME = 64; // Padding, graph lane and three internal resize handles.

export function fitHistoryColumns(available: number, preferred?: HistoryColumnWidths | null): HistoryColumnWidths {
  const minimum = HISTORY_COLUMN_MINIMUMS.reduce((sum, width) => sum + width, 0);
  const total = Math.max(minimum, available);
  const widths: HistoryColumnWidths = preferred ? [...preferred] : [80, total - 249, 105, 64];
  for (let index = 0; index < widths.length; index++) widths[index] = Math.max(HISTORY_COLUMN_MINIMUMS[index], widths[index]);
  let difference = total - widths.reduce((sum, width) => sum + width, 0);
  if (difference >= 0) widths[1] += difference;
  else {
    for (const index of [1, 0, 2, 3]) {
      const shrink = Math.min(-difference, widths[index] - HISTORY_COLUMN_MINIMUMS[index]);
      widths[index] -= shrink;
      difference += shrink;
    }
  }
  return widths;
}

export function resizeHistoryColumns(widths: HistoryColumnWidths, boundary: number, delta: number): HistoryColumnWidths {
  const next: HistoryColumnWidths = [...widths];
  if (boundary < 0 || boundary >= widths.length - 1) return next;
  const movement = Math.max(HISTORY_COLUMN_MINIMUMS[boundary] - widths[boundary], Math.min(delta, widths[boundary + 1] - HISTORY_COLUMN_MINIMUMS[boundary + 1]));
  next[boundary] += movement;
  next[boundary + 1] -= movement;
  return next;
}
