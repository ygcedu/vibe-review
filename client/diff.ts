/** Group unified diffs by file for the review card. */
export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  lines: DiffLine[];
}

export function parseDiffFiles(diffText?: string): DiffFile[] {
  if (!diffText?.trim()) return [];
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  const startFile = (path: string) => {
    current = { path, added: 0, removed: 0, lines: [] };
    files.push(current);
  };

  for (const line of diffText.replace(/\r\n/g, "\n").split("\n")) {
    const gitHeader = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitHeader) {
      startFile(gitHeader[2]);
      continue;
    }
    const newFile = /^\+\+\+ (?:b\/)?(.+?)(?: \(new file\))?$/.exec(line);
    if (newFile) {
      if (!current || current.path !== newFile[1]) startFile(newFile[1]);
      continue;
    }
    if (/^--- (?:a\/|\/dev\/null)/.test(line) || line.startsWith("index ")) continue;
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
