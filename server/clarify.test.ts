import assert from "node:assert/strict";
import test from "node:test";
import { clarifyDraft } from "./clarify.ts";

const config = { baseUrl: "http://model.test", model: "test", apiKey: "test" };

test("clarification parses the first suggestion and trims its text", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: {
    content: '说明：{"status":"suggested","suggestion":" 请检查按钮 ","reason":" 更明确 "}\n额外说明 {不是建议}',
  } }] })));
  assert.deepEqual(await clarifyDraft(config, "检查下", []), {
    status: "suggested", suggestion: "请检查按钮", reason: "更明确",
  });
});

test("clear suggestions preserve the user's original wording", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: {
    content: JSON.stringify({ status: "clear", suggestion: "模型改写", reason: 42 }),
  } }] })));
  assert.deepEqual(await clarifyDraft(config, "原文", []), { status: "clear", suggestion: "原文", reason: "" });
});

test("clarification rejects unknown statuses and blank suggestions", async (t) => {
  let value = { status: "invented", suggestion: "text" };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] })));
  await assert.rejects(clarifyDraft(config, "原文", []), /模型建议格式无效/);
  value = { status: "suggested", suggestion: "  " };
  await assert.rejects(clarifyDraft(config, "原文", []), /模型建议格式无效/);
});
