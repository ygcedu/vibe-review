import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { editDiffFiles } from "./edit-diff-data.ts";

const edit = (unifiedDiff?: string): ToolCallTimelineItem => ({
  type: "tool_call", callId: "edit-1", name: "Edit", status: "completed", error: null,
  detail: { type: "edit", filePath: "client/review.tsx", unifiedDiff },
});

test("Codex Edit patches use the existing split-diff file model", () => {
  const files = editDiffFiles(edit("@@ -168 +168 @@\n-old\n+new"));
  assert.equal(files?.[0]?.path, "client/review.tsx");
  assert.equal(files?.[0]?.removed, 1);
  assert.equal(files?.[0]?.added, 1);
});

test("edits without a usable patch keep Paseo's original card", () => {
  assert.equal(editDiffFiles(edit()), null);
  assert.equal(editDiffFiles(edit("tool result without diff markers")), null);
});
