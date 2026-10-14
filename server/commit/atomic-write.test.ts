import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { atomicWriteJson } from "./atomic-write.ts";

test("atomicWriteJson writes a valid JSON payload atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vibe-review-atomic-"));
  const target = join(dir, "record.json");
  const value = { n: 42, msg: "你好", nested: { ok: true } };
  try {
    await atomicWriteJson(target, value);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), value);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
