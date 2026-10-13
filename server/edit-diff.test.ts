import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reconstructFullEditDiff } from "./edit-diff.ts";

test("Edit patch can reveal omitted context without changing the workspace file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vibe-review-edit-test-"));
  const file = join(cwd, "sample.ts");
  const content = Array.from({ length: 20 }, (_, index) => index === 9 ? "new value" : `line ${index + 1}`).join("\n") + "\n";
  try {
    await writeFile(file, content);
    const full = await reconstructFullEditDiff(cwd, "sample.ts", "@@ -10 +10 @@\n-old value\n+new value\n");
    assert.match(full, / line 1\n/);
    assert.match(full, /-old value\n\+new value/);
    assert.match(full, / line 20\n/);
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(file, "utf8"), content);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
