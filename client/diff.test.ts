import assert from "node:assert/strict";
import test from "node:test";
import { buildSplitDiffRows, parseDiffFiles } from "./diff.ts";

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
  const rows = buildSplitDiffRows(files[0]!.lines);
  assert.deepEqual(rows.map((row) => row.kind), ["context", "change"]);
  assert.equal(rows[0]!.kind === "context" && rows[0].before.number, 93);
  assert.equal(rows[0]!.kind === "context" && rows[0].after.number, 95);
  assert.equal(rows[1]!.kind === "change" && rows[1].after.at(-1)?.number, 97);
  assert.deepEqual(buildSplitDiffRows(files[1]!.lines).map((row) => row.kind), ["change"]);
  assert.deepEqual(buildSplitDiffRows(files[2]!.lines).map((row) => row.kind), ["change"]);
});

test("legacy repeated edit markers do not appear as visible rows", () => {
  const files = parseDiffFiles([
    "diff --git a/a.ts b/a.ts", "@@ -1 +1 @@", "-first", "+second",
    "diff --git a/a.ts b/a.ts", "@@ -1 +1 @@", "-second", "+final",
  ].join("\n"));
  assert.equal(files.length, 1);
  assert.deepEqual(buildSplitDiffRows(files[0]!.lines).map((row) => row.kind), ["change", "change"]);
});
