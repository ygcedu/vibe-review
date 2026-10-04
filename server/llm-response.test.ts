import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFirstJsonObject } from "./llm-response.ts";

test("parse JSON result after prose containing template braces", () => {
  const text = '已检查 {{changedFiles}}，以下是结果：\n{"status":"passed","summary":"完成"}';
  assert.deepEqual(parseFirstJsonObject(text), { status: "passed", summary: "完成" });
});

test("invalid JSON still reports a format error", () => {
  assert.throws(() => parseFirstJsonObject("说明 {{...}} 最终 {status: passed}"), /JSON 对象/);
});
