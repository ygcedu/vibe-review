import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { recentCommitContext } from "./commit-context.ts";
import { piPreviewArgs } from "./pi-commit.ts";

const review = (goal: string, diff = "diff --git a/a b/a") => ({
  type: "plugin" as const, id: goal, pluginId: "vibe-review", kind: "review-result", version: 1,
  data: { verdict: "pass", completed: 1, drift: "in_scope", summary: goal, goal, narrative: `${goal} 已完成`, scoredAt: "2026-10-03", diff },
});

test("commit context uses recent changed reviews since the last Pi commit", () => {
  const timeline: AgentTimelineItem[] = [
    review("旧任务"),
    { type: "plugin", id: "commit-1", pluginId: "vibe-review", kind: "pi-commit-result", version: 1, data: { ok: true, summary: "done" } },
    review("无文件变更", ""),
    review("当前任务"),
  ];
  const context = recentCommitContext(timeline);
  assert.match(context, /当前任务/);
  assert.doesNotMatch(context, /旧任务|无文件变更/);
  const prompt = piPreviewArgs({ executable: "pi", provider: "", model: "" }, "diff", ["file.ts"], context).at(-1)!;
  assert.match(prompt, /审核分析仅用于理解修改目的/);
  assert.match(prompt, /实际 diff/);
});
