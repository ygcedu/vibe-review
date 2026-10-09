import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDistillPrompt, distillTask } from "./distill.ts";
import { DEFAULT_REVIEW_PROMPT } from "../shared/prompts.ts";

test("follow-up prompt favors one suggestion and parser caps unique suggestions at three", async () => {
  const prompt = buildDistillPrompt(["修复登录"], ["已修复"]);
  assert.match(prompt, /优先只给最有价值的 1 条/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: [
    "goal: 修复登录",
    "drifts: 无",
    "narrative: 已修复登录问题。",
    "result: done",
    "task_type: verification_required",
    'followups: ["请验证登录失败时的提示是否清楚。","请验证登录失败时的提示是否清楚。","请检查退出登录流程。","请检查会话过期后的行为。","请检查其他页面。"]',
  ].join("\n") } }] }) + 'data: {"extra":true}', { status: 200 });
  try {
    const result = await distillTask({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test" }, ["修复登录"], ["已修复"]);
    assert.equal(result.result, "done");
    assert.equal(result.taskType, "verification_required");
    assert.deepEqual(result.followups, ["请验证登录失败时的提示是否清楚。", "请检查退出登录流程。", "请检查会话过期后的行为。"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a valid review without followups still yields one suggestion", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "goal: 修复登录\ndrifts: 无\nnarrative: 已修复。\nresult: done" } }] }), { status: 200 });
  try {
    const result = await distillTask({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test" }, ["修复登录"], ["已修复"]);
    assert.equal(result.followups.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review goal is preserved beyond 80 characters", async () => {
  const goal = "改进插件对 agent 文件修改的统计方式，使其在 agent 工作目录之外的文件也能被捕获；参考 codex 的做法，若当前 agent 是 codex 则采用相应方式统计完整文件变更";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: `goal: ${goal}\ndrifts: 无\nnarrative: 已处理。\nresult: done` } }] }), { status: 200 });
  try {
    const result = await distillTask({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test" }, [goal], ["已处理"]);
    assert.equal(result.goal, goal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("punctuated no-drift answer is not counted as a deviation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "goal: 修复登录\ndrifts: 无。\nnarrative: 已修复。\nresult: done" } }] }), { status: 200 });
  try {
    const result = await distillTask({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test" }, ["修复登录"], ["已修复"]);
    assert.deepEqual(result.drifts, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review template is used while the required output contract remains", () => {
  const prompt = buildDistillPrompt(["任务"], ["结果"], undefined, 0, undefined, false, DEFAULT_REVIEW_PROMPT.replace("你是对话审核助手。", "自定义评估标准。"));
  assert.match(prompt, /自定义评估标准/);
  assert.match(prompt, /goal: \.\.\./);
  assert.match(prompt, /<user_messages>/);
});
