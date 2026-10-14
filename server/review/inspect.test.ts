import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskSummary, isSessionControlCommand } from "../review/inspect.ts";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

test("skips session controls without hiding task slash commands", () => {
  for (const input of ["/compact", "  /compact  ", "/model gpt-6", "/models", "/clear", "/reset", "/new"]) {
    assert.equal(isSessionControlCommand(input), true, input);
  }
  for (const input of ["/review", "/goal finish this", "/compactness", "Please run /compact", "/modeling task"]) {
    assert.equal(isSessionControlCommand(input), false, input);
  }
});

test("task summary preserves the full current user message", () => {
  const task = "请检查所有相关路径。".repeat(50);
  const summary = buildTaskSummary([{ type: "user_message", text: task } as AgentTimelineItem]);
  assert.equal(summary.task, task);
  assert.deepEqual(summary.userMessages, [task]);
});
