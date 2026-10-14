import type { DiffCell, SplitDiffRow } from "./diff";

export type TextSpan = { start: number; end: number };

const MAX_TOKENS = 200;
const MAX_PAIR_LINES = 80;

function tokens(text: string): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /\s+|[A-Za-z_$][\w$]*|\d+|./gu;
  for (const match of text.matchAll(pattern)) {
    result.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return result;
}

function edgeSpans(before: string, after: string): { before: TextSpan[]; after: TextSpan[] } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    before: start < oldEnd ? [{ start, end: oldEnd }] : [],
    after: start < newEnd ? [{ start, end: newEnd }] : [],
  };
}

function unmatchedSpans(items: ReturnType<typeof tokens>, matched: Set<number>): TextSpan[] {
  const spans: TextSpan[] = [];
  items.forEach((token, index) => {
    if (matched.has(index)) return;
    const previous = spans.at(-1);
    if (previous?.end === token.start) previous.end = token.end;
    else spans.push({ start: token.start, end: token.end });
  });
  return spans;
}

/** Changed ranges on both sides, preserving separate edits within one line. */
export function changedTextSpans(before: string, after: string): { before: TextSpan[]; after: TextSpan[] } {
  if (before === after) return { before: [], after: [] };
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  if (oldTokens.length > MAX_TOKENS || newTokens.length > MAX_TOKENS) return edgeSpans(before, after);
  const widths = Array.from({ length: oldTokens.length + 1 }, () => new Uint16Array(newTokens.length + 1));
  for (let i = oldTokens.length - 1; i >= 0; i--) {
    for (let j = newTokens.length - 1; j >= 0; j--) {
      widths[i][j] = oldTokens[i].text === newTokens[j].text ? 1 + widths[i + 1][j + 1] : Math.max(widths[i + 1][j], widths[i][j + 1]);
    }
  }
  const matchedBefore = new Set<number>();
  const matchedAfter = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < oldTokens.length && j < newTokens.length) {
    if (oldTokens[i].text === newTokens[j].text) {
      matchedBefore.add(i);
      matchedAfter.add(j);
      i++;
      j++;
    } else if (widths[i + 1][j] >= widths[i][j + 1]) i++;
    else j++;
  }
  return { before: unmatchedSpans(oldTokens, matchedBefore), after: unmatchedSpans(newTokens, matchedAfter) };
}

function similarity(before: string, after: string): number {
  if (before === after) return 1;
  const denominator = Math.max(before.length, after.length);
  if (!denominator) return 1;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return (prefix + suffix) / denominator;
}

/** Match related lines without shifting all later pairs when a line is inserted. */
function alignLines(before: DiffCell[], after: DiffCell[]): Array<number | undefined> {
  if (before.length > MAX_PAIR_LINES || after.length > MAX_PAIR_LINES) return after.map((_, index) => index < before.length ? index : undefined);
  const scores = Array.from({ length: before.length + 1 }, () => new Float32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const match = similarity(before[i].text, after[j].text);
      scores[i][j] = Math.max(scores[i + 1][j], scores[i][j + 1], match >= 0.3 ? match + scores[i + 1][j + 1] : 0);
    }
  }
  const aligned: Array<number | undefined> = Array(after.length).fill(undefined);
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const match = similarity(before[i].text, after[j].text);
    if (match >= 0.3 && match + scores[i + 1][j + 1] >= scores[i][j] - 0.001) {
      aligned[j] = i;
      i++;
      j++;
    } else if (scores[i + 1][j] >= scores[i][j + 1]) i++;
    else j++;
  }
  return aligned;
}

export function changedSpansByCell(rows: SplitDiffRow[]): Map<DiffCell, TextSpan[]> {
  const result = new Map<DiffCell, TextSpan[]>();
  for (const row of rows) {
    if (row.kind !== "change" || row.tone !== "modify") continue;
    const aligned = alignLines(row.before, row.after);
    const matchedBefore = new Set<number>();
    row.after.forEach((cell, index) => {
      const oldIndex = aligned[index];
      if (oldIndex === undefined) {
        if (cell.text) result.set(cell, [{ start: 0, end: cell.text.length }]);
        return;
      }
      matchedBefore.add(oldIndex);
      const spans = changedTextSpans(row.before[oldIndex].text, cell.text);
      if (spans.before.length) result.set(row.before[oldIndex], spans.before);
      if (spans.after.length) result.set(cell, spans.after);
    });
    row.before.forEach((cell, index) => {
      if (!matchedBefore.has(index) && cell.text) result.set(cell, [{ start: 0, end: cell.text.length }]);
    });
  }
  return result;
}
