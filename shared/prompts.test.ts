import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REVIEW_PROMPT, missingPromptVariables, promptTemplateSchema, promptTemplateSettings, renderPrompt } from "./prompts.ts";

test("templates keep required dynamic variables editable", () => {
  assert.deepEqual(missingPromptVariables("review", DEFAULT_REVIEW_PROMPT), []);
  assert.deepEqual(missingPromptVariables("review", DEFAULT_REVIEW_PROMPT.replace("{{changedFiles}}", "")), ["changedFiles"]);
  assert.equal(promptTemplateSchema.safeParse({ review: DEFAULT_REVIEW_PROMPT.replace("{{changedFiles}}", "") }).success, false);
  assert.equal(renderPrompt("{{userMessages}} / {{changedFiles}}", { userMessages: "用户问题", changedFiles: "diff" }), "用户问题 / diff");
});

test("old instruction-only settings migrate without losing custom text", async () => {
  const migrated = await promptTemplateSettings.migrate!({ review: "我的评估规则", verification: "我的验证规则", piCommit: "我的提交规则" }, 1);
  const parsed = promptTemplateSchema.parse(migrated);
  assert.match(parsed.review, /^我的评估规则/);
  assert.match(parsed.review, /{{userMessages}}/);
  assert.match(parsed.verification, /{{goal}}/);
  assert.match(parsed.piCommit, /{{diff}}/);
});
