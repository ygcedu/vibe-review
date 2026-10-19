import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIdeShelf, readIdeShelfDiff } from "./workspace-shelf.ts";

test("reads IDE shelf metadata, patch paths, binary files and excludes recycled entries", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-ide-shelf-"));
  try {
    assert.deepEqual(await readIdeShelf(cwd), []);
    await mkdir(join(cwd, ".idea/shelf/change"), { recursive: true });
    await writeFile(join(cwd, ".idea/shelf/change/shelved.patch"), "Index: package.json\nIndex: 中文 文件.ts\n");
    await writeFile(join(cwd, ".idea/shelf/change.xml"), `<changelist name="change" date="1792401477284" recycled="false">
      <option name="PATH" value="$PROJECT_DIR$/.idea/shelf/change/shelved.patch" />
      <option name="DESCRIPTION" value="修复 &amp; &#x4e2d; &quot;说明&quot;" />
      <binary BEFORE_PATH="old.png" AFTER_PATH="new.png" /></changelist>`);
    await writeFile(join(cwd, ".idea/shelf/deleted.xml"), '<changelist name="deleted" recycled="true"><option name="PATH" value="missing.patch" /></changelist>');
    const entries = await readIdeShelf(cwd);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, '修复 & 中 "说明"');
    assert.deepEqual(entries[0].files, ["package.json", "中文 文件.ts", "new.png"]);
    await writeFile(join(cwd, ".idea/shelf/outside.xml"), '<changelist name="outside"><option name="PATH" value="../outside.patch" /></changelist>');
    await assert.rejects(readIdeShelf(cwd), /超出项目目录/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

 test("shelf diff selects only the requested file and omits IDE metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-shelf-diff-"));
  try {
    await mkdir(join(cwd, ".idea/shelf/change"), { recursive: true });
    await writeFile(join(cwd, ".idea/shelf/change.xml"), '<changelist name="change"><option name="PATH" value="$PROJECT_DIR$/.idea/shelf/change/shelved.patch" /></changelist>');
    await writeFile(join(cwd, ".idea/shelf/change/shelved.patch"), 'Index: src/a.ts\nIDEA additional info:\n<+>metadata\n===\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\nIndex: b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n');
    const diff = await readIdeShelfDiff(cwd, "idea:change.xml", "src/a.ts");
    assert.ok(diff.startsWith("diff --git a/src/a.ts b/src/a.ts\n---"));
    assert.ok(diff.includes("+new"));
    assert.ok(!diff.includes("metadata"));
    assert.ok(!diff.includes("b.ts"));
    await assert.rejects(readIdeShelfDiff(cwd, "idea:../change.xml", "src/a.ts"), /已变化/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
