import { highlightCode, isLanguageSupported, type HighlightToken } from "@getpaseo/highlight";
import type { DiffCell, SplitDiffRow } from "./diff";

const MAX_HIGHLIGHT_CHARS = 100_000;

/** Highlight old and new document text separately, as Paseo does for edit diffs. */
export function highlightSplitRows(rows: SplitDiffRow[], path: string): Map<DiffCell, HighlightToken[]> {
  const result = new Map<DiffCell, HighlightToken[]>();
  if (!isLanguageSupported(path)) return result;

  const before: DiffCell[] = [];
  const after: DiffCell[] = [];
  for (const row of rows) {
    if (row.kind === "header") continue;
    if (row.kind === "context") {
      before.push(row.before);
      after.push(row.after);
    } else {
      before.push(...row.before);
      after.push(...row.after);
    }
  }

  const tokenize = (cells: DiffCell[]) => {
    const code = cells.map((cell) => cell.text).join("\n");
    if (!code || code.length > MAX_HIGHLIGHT_CHARS) return;
    try {
      const lines = highlightCode(code, path);
      cells.forEach((cell, index) => {
        if (lines[index]) result.set(cell, lines[index]);
      });
    } catch {
      // Preserve the plain diff if a grammar cannot parse this fragment.
    }
  };
  tokenize(before);
  tokenize(after);
  return result;
}
