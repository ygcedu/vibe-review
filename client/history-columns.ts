export type HistoryColumnWidths = [number, number, number, number];
export const HISTORY_COLUMN_MINIMUMS: HistoryColumnWidths = [48, 120, 88, 64];
export const HISTORY_TABLE_CHROME = 64; // Padding, graph lane and three internal resize handles.

export function fitHistoryColumns(available: number, preferred?: HistoryColumnWidths | null): HistoryColumnWidths {
  const minimum = HISTORY_COLUMN_MINIMUMS.reduce((sum, width) => sum + width, 0);
  const total = Math.max(minimum, available);
  const widths: HistoryColumnWidths = preferred ? [...preferred] : [80, total - 249, 105, 64];
  for (let index = 0; index < widths.length; index++) widths[index] = Math.max(HISTORY_COLUMN_MINIMUMS[index], widths[index]);
  // Once adjusted, retain the user's widths; narrower panels scroll horizontally.
  if (!preferred) {
    let difference = total - widths.reduce((sum, width) => sum + width, 0);
    for (const index of [1, 0, 2, 3]) {
      if (difference >= 0) { widths[1] += difference; break; }
      const shrink = Math.min(-difference, widths[index] - HISTORY_COLUMN_MINIMUMS[index]);
      widths[index] -= shrink;
      difference += shrink;
    }
  }
  return widths;
}

export function resizeHistoryColumns(widths: HistoryColumnWidths, boundary: number, delta: number): HistoryColumnWidths {
  const next: HistoryColumnWidths = [...widths];
  next[boundary] = Math.max(HISTORY_COLUMN_MINIMUMS[boundary], widths[boundary] + delta);
  return next;
}
