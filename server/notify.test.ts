import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { appleScriptString, notify } from "./notify.ts";

const execFileAsync = promisify(execFile);

test("appleScriptString escapes backslashes before quotes", () => {
  assert.equal(appleScriptString(`has "quote" and \\back`), `"has \\"quote\\" and \\\\back"`);
  assert.equal(appleScriptString("plain text 中文"), `"plain text 中文"`);
});

test("generated osascript syntax is valid even for hostile input", async () => {
  const host = process.platform;
  if (host !== "darwin" || !await execFileAsync("which", ["osascript"]).then(() => true, () => false)) return;
  const hostile = 'He said "hi", then ran: echo \n more';
  const expected = hostile.replace(/[\r\n]/g, " ");
  const script = `set t to ${appleScriptString("Title " + hostile)} & ${appleScriptString(hostile)}`;
  const { stdout } = await execFileAsync("osascript", ["-e", script, "-e", "return t"]);
  assert.equal(stdout.trim(), `Title ${expected}` + expected);
});

test("notify never rejects on osascript failure", async () => {
  await notify("测试标题", "消息含 \"引号\" 与 \\反斜杠");
});
