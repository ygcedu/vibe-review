import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface TaskSummary {
  task: string;
  userMessages: string[];
  assistantMessages: string[];
  /** 最近一轮的代码变更（unified diff，供卡片显示；LLM 提示词另行截断）。 */
  lastTurnDiff: string;
  shellCommands: number;
  /** 停在 running 的工具数；>0 说明 agent 中途断开会话。 */
  runningTools: number;
}

const CARD_DIFF_BUDGET = 24000;

/** 最近一次 user_message 之后完成的 write/edit 工具调用（本轮的改动），diff 与文件列表共用，天然一致。 */
function lastTurnEdits(timeline: readonly AgentTimelineItem[]) {
  const lastUserAt = timeline.reduce((acc, item, i) => (item.type === "user_message" ? i : acc), -1);
  const edits: Array<{ type: "edit" | "write"; filePath: string; diff?: string }> = [];
  for (const item of timeline.slice(lastUserAt + 1)) {
    if (item.type !== "tool_call" || item.status === "running") continue;
    const detail = item.detail;
    if (detail.type === "edit") {
      const rawDiff = detail.unifiedDiff ??
        (detail.oldString || detail.newString ? `--- a/${detail.filePath}\n+++ b/${detail.filePath}\n-${detail.oldString ?? ""}\n+${detail.newString ?? ""}` : undefined);
      const diff = rawDiff && !rawDiff.startsWith("diff --git")
        ? `diff --git a/${detail.filePath} b/${detail.filePath}\n${rawDiff}`
        : rawDiff;
      edits.push({ type: "edit", filePath: detail.filePath, diff });
    } else if (detail.type === "write") {
      const diff = detail.content ? `diff --git a/${detail.filePath} b/${detail.filePath}\n+++ b/${detail.filePath}\n${detail.content.split("\n").map((l) => `+${l}`).join("\n")}` : undefined;
      edits.push({ type: "write", filePath: detail.filePath, diff });
    }
  }
  return edits;
}

/** 本轮的 diff（timeline data 有 64 KiB 限制，保留最多 24 KiB）。 */
function lastTurnDiff(edits: ReturnType<typeof lastTurnEdits>): string {
  const joined = edits.filter((e) => e.diff).map((e) => e.diff as string).join("\n");
  return Buffer.from(joined).subarray(0, CARD_DIFF_BUDGET).toString("utf8");
}

/** Extract a compact review state from the full agent timeline. */
export function buildTaskSummary(timeline: readonly AgentTimelineItem[]): TaskSummary {
  // 全部以"最近一次 user_message 之后"为本轮窗口，和 diff 同源，避免窗口错位。
  const lastUserAt = timeline.reduce((acc, item, i) => (item.type === "user_message" ? i : acc), -1);
  const lastTurn = timeline.slice(lastUserAt + 1);

  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  let shellCommands = 0;
  let runningTool = 0;

  // 历史用户消息（最多 6 条）只用于理解目标上下文；最近 1 条即"本轮任务"。
  const allUsers: string[] = [];
  for (const item of timeline) {
    if (item.type === "user_message") allUsers.push(item.text);
  }

  for (const item of lastTurn) {
    if (item.type === "assistant_message") assistantMessages.push(item.text);
    if (item.type === "tool_call") {
      if (item.status === "running") runningTool++;
      else if (item.detail.type === "shell") shellCommands++;
    }
  }

  const edits = lastTurnEdits(timeline);
  const diff = lastTurnDiff(edits);

  const recentUsers = allUsers.slice(-6);
  const task = recentUsers[recentUsers.length - 1]?.slice(0, 400) ?? "";

  return {
    task,
    userMessages: recentUsers.map((m) => m.slice(0, 300)),
    assistantMessages,
    lastTurnDiff: diff,
    shellCommands,
    runningTools: runningTool,
  };
}
