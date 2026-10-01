/** 解析 unified diff 为带类型的行，供卡片渲染（借鉴 paseo 源码 diff-viewer）。 */
export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
}

export function parseUnifiedDiff(diffText?: string): DiffLine[] {
  if (!diffText) return [];
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const out: DiffLine[] = [];
  for (const line of lines) {
    if (!line.length) {
      out.push({ type: "context", content: line });
      continue;
    }
    if (line.startsWith("@@")) {
      out.push({ type: "header", content: line });
      continue;
    }
    if (line.startsWith("diff --git")) {
      out.push({ type: "header", content: line.replace(/^diff --git a\/\S+ b\//, "文件 ") });
      continue;
    }
    if (line.startsWith("+")) {
      if (!line.startsWith("+++")) out.push({ type: "add", content: line });
      continue;
    }
    if (line.startsWith("-")) {
      if (!line.startsWith("---")) out.push({ type: "remove", content: line });
      continue;
    }
    if (
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      out.push({ type: "header", content: line });
      continue;
    }
    out.push({ type: "context", content: line });
  }
  return out;
}
