import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { parseDiffFiles, type DiffFile } from "./diff.ts";

/** Keep the native tool card until Paseo supplies an actual patch to render. */
export function editDiffFiles(item: ToolCallTimelineItem): DiffFile[] | null {
  if (item.detail.type !== "edit" || !item.detail.unifiedDiff?.trim()) return null;
  if (!/^(?:diff --git |@@ |--- |\+\+\+ )/m.test(item.detail.unifiedDiff)) return null;
  const files = parseDiffFiles(item.detail.unifiedDiff);
  if (!files.length) return null;
  if (files.length === 1 && files[0]!.path === "修改内容") files[0]!.path = item.detail.filePath;
  return files;
}
