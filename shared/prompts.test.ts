import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REVIEW_PROMPT, DEFAULT_VERIFICATION_PROMPT, DEFAULT_PI_COMMIT_PROMPT, composePromptTemplate, missingPromptVariables, promptEditableParts, promptFixedPart, promptFixedSegments, promptTemplateSchema, promptTemplateSettings, renderPrompt } from "./prompts.ts";

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

test("editable gaps compose around immutable segments", () => {
  const parts = promptEditableParts("review", DEFAULT_REVIEW_PROMPT)!;
  parts[0] = "自定义评估规则\n\n";
  parts[2] = "\n\n请特别核对文件清单。\n\n";
  const edited = composePromptTemplate("review", parts);
  assert.deepEqual(promptEditableParts("review", edited), parts);
  assert.ok(edited.includes(`${promptFixedSegments("review")[1]}\n\n请特别核对文件清单。`));
  assert.equal(promptTemplateSchema.safeParse({ review: edited }).success, true);
  assert.equal(promptTemplateSchema.safeParse({ review: edited.replace("{{changedFiles}}", "") }).success, false);
});

test("all three templates round-trip through editable gaps", () => {
  for (const [kind, template] of [["review", DEFAULT_REVIEW_PROMPT], ["verification", DEFAULT_VERIFICATION_PROMPT], ["piCommit", DEFAULT_PI_COMMIT_PROMPT]] as const) {
    const parts = promptEditableParts(kind, template);
    assert.ok(parts);
    assert.equal(parts.length, promptFixedSegments(kind).length + 1);
    assert.equal(composePromptTemplate(kind, parts), template);
  }
});

test("v4 templates compact only untouched separators", async () => {
  for (const [kind, template] of [["review", DEFAULT_REVIEW_PROMPT], ["verification", DEFAULT_VERIFICATION_PROMPT], ["piCommit", DEFAULT_PI_COMMIT_PROMPT]] as const) {
    const parts = promptEditableParts(kind, template)!;
    parts[1] = "\n\n";
    parts[2] = "\n\n自定义中间规则\n\n";
    const previous = composePromptTemplate(kind, parts);
    const migrated = await promptTemplateSettings.migrate!({ [kind]: previous }, 4);
    const next = promptEditableParts(kind, promptTemplateSchema.parse(migrated)[kind])!;
    assert.equal(next[1], "\n");
    assert.equal(next[2], "\n\n自定义中间规则\n\n");
  }
});

test("v2 full custom template retains its text when fixed section is added", async () => {
  const previous = DEFAULT_REVIEW_PROMPT.replace("<user_messages>", "<custom_user_messages>");
  const migrated = await promptTemplateSettings.migrate!({ review: previous }, 2);
  const parsed = promptTemplateSchema.parse(migrated);
  assert.match(parsed.review, /<custom_user_messages>/);
  assert.ok(parsed.review.endsWith(promptFixedPart("review")));
});
