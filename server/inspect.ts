import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { absoluteEditPath, type NewFileDiff } from "./new-files";

export interface TaskSummary {
  task: string;
  userMessages: string[];
  assistantMessages: string[];
  /** 最近一轮的代码变更（unified diff，卡片与 LLM 使用同一份内容）。 */
  lastTurnDiff: string;
  shellCommands: number;
  /** 停在 running 的工具数；>0 说明 agent 中途断开会话。 */
  runningTools: number;
}

/** 最近一次 user_message 之后完成的 write/edit 工具调用。 */
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

/** 本轮所有 edit/write 工具记录的 diff，按发生顺序拼接。 */
function lastTurnDiff(edits: ReturnType<typeof lastTurnEdits>): string {
  return edits.filter((e) => e.diff).map((e) => e.diff as string).join("\n");
}

/** Extract a compact review state from the full agent timeline. */
export function buildTaskSummary(
  timeline: readonly AgentTimelineItem[],
  newFiles: NewFileDiff[] = [],
  cwd?: string,
): TaskSummary {
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

  const newPaths = new Set(newFiles.map((file) => file.absolutePath));
  const edits = lastTurnEdits(timeline).filter((edit) => !cwd || !newPaths.has(absoluteEditPath(cwd, edit.filePath)));
  const diff = [lastTurnDiff(edits), ...newFiles.map((file) => file.diff)].filter(Boolean).join("\n");

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
