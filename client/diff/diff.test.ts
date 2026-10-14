import assert from "node:assert/strict";
import test from "node:test";
import { buildPaneRows, buildSplitDiffRows, expandCollapsedRows, gapKey, parseDiffFiles } from "./diff.ts";

test("snapshot diff renders only code rows, with correct file and line numbers", () => {
  const diff = [
    "diff --git a/src/edited.ts b/src/edited.ts",
    "index 1234567..abcdef0 100644",
    "--- a/src/edited.ts",
    "+++ b/src/edited.ts",
    "@@ -93,2 +95,3 @@",
    " before",
    "-old",
    "+new",
    "+another",
    "diff --git a/src/new.ts b/src/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/new.ts",
    "@@ -0,0 +1 @@",
    "+created",
    "diff --git a/src/deleted.ts b/src/deleted.ts",
    "deleted file mode 100644",
    "--- a/src/deleted.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-removed",
  ].join("\n");
  const files = parseDiffFiles(diff);
  assert.deepEqual(files.map((file) => file.path), ["src/edited.ts", "src/new.ts", "src/deleted.ts"]);
  assert.deepEqual(files.map((file) => file.status), ["modified", "added", "deleted"]);
  const rows = buildSplitDiffRows(files[0]!.lines);
  assert.deepEqual(rows.map((row) => row.kind), ["context", "change"]);
  assert.equal(rows[0]!.kind === "context" && rows[0].before.number, 93);
  assert.equal(rows[0]!.kind === "context" && rows[0].after.number, 95);
  assert.equal(rows[1]!.kind === "change" && rows[1].after.at(-1)?.number, 97);
  assert.deepEqual(buildSplitDiffRows(files[1]!.lines).map((row) => row.kind), ["change"]);
  assert.deepEqual(buildSplitDiffRows(files[2]!.lines).map((row) => row.kind), ["change"]);
});

test("pane rows flow independently and show only skipped ranges as waves", () => {
  const files = parseDiffFiles([
    "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
    "@@ -1,2 +1,3 @@", " same", "+extra", " next",
    "@@ -20,2 +21,2 @@", " later", "-old", "+new",
  ].join("\n"));
  const rows = buildSplitDiffRows(files[0]!.lines);
  const before = buildPaneRows(rows, "before");
  const after = buildPaneRows(rows, "after");
  assert.deepEqual(before.map((row) => row.kind), ["code", "change", "code", "wave", "code", "change"]);
  assert.deepEqual(after.map((row) => row.kind), ["code", "change", "code", "wave", "code", "change"]);
  assert.equal(before[1]!.kind === "change" && before[1].cells.length, 0);
  assert.equal(after[1]!.kind === "change" && after[1].cells.length, 1);
});

test("legacy repeated edit markers do not appear as visible rows", () => {
  const files = parseDiffFiles([
    "diff --git a/a.ts b/a.ts", "@@ -1 +1 @@", "-first", "+second",
    "diff --git a/a.ts b/a.ts", "@@ -1 +1 @@", "-second", "+final",
  ].join("\n"));
  assert.equal(files.length, 1);
  assert.deepEqual(buildSplitDiffRows(files[0]!.lines).map((row) => row.kind), ["change", "change"]);
});

test("opening one skipped range inserts only its unchanged lines", () => {
  const compact = buildSplitDiffRows([
    { type: "header", content: "@@ -1 +1 @@" }, { type: "context", content: " one" },
    { type: "header", content: "@@ -4 +4 @@" }, { type: "context", content: " four" },
    { type: "header", content: "@@ -7 +7 @@" }, { type: "context", content: " seven" },
  ]);
  const full = buildSplitDiffRows([
    { type: "header", content: "@@ -1,7 +1,7 @@" },
    ...["one", "two", "three", "four", "five", "six", "seven"].map((text) => ({ type: "context" as const, content: ` ${text}` })),
  ]);
  const expanded = expandCollapsedRows(compact, full, new Set([gapKey(compact[1]!) ]));
  assert.deepEqual(expanded.map((row) => row.kind === "context" ? row.before.text : "change"), ["one", "two", "three", "four", "seven"]);
  assert.equal(buildPaneRows(expanded, "before").filter((row) => row.kind === "wave").length, 1);
});
