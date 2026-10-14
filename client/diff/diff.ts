/** Group unified diffs by file for the review card. */
export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  added: number;
  removed: number;
  lines: DiffLine[];
}

export interface DiffCell {
  number?: number;
  text: string;
  type: "context" | "add" | "remove";
}

export type SplitDiffRow =
  | { kind: "header"; label: string }
  | { kind: "context"; before: DiffCell; after: DiffCell }
  | { kind: "change"; before: DiffCell[]; after: DiffCell[]; tone: "modify" | "add" | "remove" };

export type PaneRow =
  | { kind: "wave"; key: string; index: number }
  | { kind: "code"; key: string; cell: DiffCell }
  | { kind: "change"; key: string; index: number; cells: DiffCell[]; tone: "modify" | "add" | "remove" };

/** Each side flows independently. A skipped source range gets a small wave divider. */
export function buildPaneRows(rows: SplitDiffRow[], side: "before" | "after"): PaneRow[] {
  const result: PaneRow[] = [];
  let lastNumber: number | undefined;
  rows.forEach((row, index) => {
    if (row.kind === "header") return;
    const cells = row.kind === "context" ? [row[side]] : row[side];
    const first = cells[0]?.number;
    if (first !== undefined && (lastNumber === undefined ? first > 1 : first !== lastNumber + 1)) {
      result.push({ kind: "wave", key: `wave-${index}`, index });
    }
    if (row.kind === "context") result.push({ kind: "code", key: `code-${index}`, cell: row[side] });
    else result.push({ kind: "change", key: `change-${index}`, index, cells: row[side], tone: row.tone });
    const last = cells.at(-1)?.number;
    if (last !== undefined) lastNumber = last;
  });
  return result;
}

/** Keep each change run together so different line counts can share one block height. */
export function buildSplitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let beforeNumber: number | undefined;
  let afterNumber: number | undefined;
  let removed: DiffCell[] = [];
  let added: DiffCell[] = [];

  const flushChanges = () => {
    if (removed.length || added.length) rows.push({
      kind: "change",
      before: removed,
      after: added,
      tone: removed.length && added.length ? "modify" : removed.length ? "remove" : "add",
    });
    removed = [];
    added = [];
  };

  for (const line of lines) {
    if (line.type === "header") {
      flushChanges();
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line.content);
      if (hunk) {
        beforeNumber = Number(hunk[1]);
        afterNumber = Number(hunk[2]);
      } else if (line.content === "再次修改") {
        beforeNumber = undefined;
        afterNumber = undefined;
      }
      // Hunk coordinates only set line numbers; they are not visible diff rows.
      continue;
    }

    const text = line.content.slice(1);
    if (line.type === "remove") {
      if (beforeNumber === undefined) beforeNumber = 1;
      removed.push({ number: beforeNumber++, text, type: "remove" });
    } else if (line.type === "add") {
      if (afterNumber === undefined) afterNumber = 1;
      added.push({ number: afterNumber++, text, type: "add" });
    } else {
      flushChanges();
      const content = line.content.startsWith(" ") ? text : line.content;
      rows.push({ kind: "context", before: { number: beforeNumber, text: content, type: "context" }, after: { number: afterNumber, text: content, type: "context" } });
      if (beforeNumber !== undefined) beforeNumber++;
      if (afterNumber !== undefined) afterNumber++;
    }
  }
  flushChanges();
  return rows;
}

function firstNumber(row: SplitDiffRow, side: "before" | "after"): number | undefined {
  return row.kind === "context" ? row[side].number : row.kind === "change" ? row[side][0]?.number : undefined;
}

function lastNumber(row: SplitDiffRow, side: "before" | "after"): number | undefined {
  return row.kind === "context" ? row[side].number : row.kind === "change" ? row[side].at(-1)?.number : undefined;
}

export function gapKey(row: SplitDiffRow): string {
  return `${firstNumber(row, "before") ?? ""}:${firstNumber(row, "after") ?? ""}`;
}

/** Insert only the unchanged ranges the user has opened; other gaps stay collapsed. */
export function expandCollapsedRows(rows: SplitDiffRow[], fullRows: SplitDiffRow[], opened: Set<string>): SplitDiffRow[] {
  const result: SplitDiffRow[] = [];
  let before = 0;
  let after = 0;
  for (const row of rows) {
    const nextBefore = firstNumber(row, "before");
    const nextAfter = firstNumber(row, "after");
    if (opened.has(gapKey(row)) && (nextBefore !== undefined || nextAfter !== undefined)) {
      result.push(...fullRows.filter((candidate) => candidate.kind === "context" &&
        candidate.before.number !== undefined && candidate.after.number !== undefined &&
        candidate.before.number > before && candidate.after.number > after &&
        (nextBefore === undefined || candidate.before.number < nextBefore) &&
        (nextAfter === undefined || candidate.after.number < nextAfter)));
    }
    result.push(row);
    before = lastNumber(row, "before") ?? before;
    after = lastNumber(row, "after") ?? after;
  }
  return result;
}

export function parseDiffFiles(diffText?: string): DiffFile[] {
  if (!diffText?.trim()) return [];
  const files: DiffFile[] = [];
  const byPath = new Map<string, DiffFile>();
  let current: DiffFile | undefined;
  const startFile = (path: string) => {
    current = byPath.get(path);
    if (current) {
      current.lines.push({ type: "header", content: "再次修改" });
    } else {
      current = { path, status: "modified", added: 0, removed: 0, lines: [] };
      byPath.set(path, current);
      files.push(current);
    }
  };

  for (const line of diffText.replace(/\r\n/g, "\n").split("\n")) {
    const gitHeader = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitHeader) {
      startFile(gitHeader[2]);
      continue;
    }
    const newFile = /^\+\+\+ (?:b\/)?(.+?)(?: \(new file\))?$/.exec(line);
    if (newFile && newFile[1] !== "/dev/null") {
      if (!current || current.path !== newFile[1]) startFile(newFile[1]);
      continue;
    }
    if (line.startsWith("new file mode ") || line === "--- /dev/null") {
      if (current) current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode ") || line === "+++ /dev/null") {
      if (current) current.status = "deleted";
      continue;
    }
    if (/^--- (?:a\/|\/dev\/null)/.test(line) || /^(?:index |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/.test(line)) continue;
    if (!current) startFile("修改内容");
    if (line.startsWith("+")) {
      current!.added++;
      current!.lines.push({ type: "add", content: line });
    } else if (line.startsWith("-")) {
      current!.removed++;
      current!.lines.push({ type: "remove", content: line });
    } else if (line.startsWith("@@") || line.startsWith("\\ No newline")) {
      current!.lines.push({ type: "header", content: line });
    } else if (line.length) {
      current!.lines.push({ type: "context", content: line });
    }
  }
  return files.filter((file) => file.lines.length || file.added || file.removed);
}
