import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface TaskSummary {
  task: string;
  userMessages: string[];
  assistantMessages: string[];
  changedFiles: string[];
  /** 最近一轮的代码变更（unified diff，截断后的文本），供审核 LLM 判断实现。 */
  lastTurnDiff: string;
  shellCommands: number;
  /** 停在 running 的工具数；>0 说明 agent 中途断开会话。 */
  runningTools: number;
  finalOutput: string;
}

const DIFF_BUDGET = 2000;

/** 最近一次 user_message 之后完成的 write/edit 工具调用（本轮的改动），diff 与文件列表共用，天然一致。 */
function lastTurnEdits(timeline: readonly AgentTimelineItem[]) {
  const lastUserAt = timeline.reduce((acc, item, i) => (item.type === "user_message" ? i : acc), -1);
  const edits: Array<{ type: "edit" | "write"; filePath: string; diff?: string }> = [];
  for (const item of timeline.slice(lastUserAt + 1)) {
    if (item.type !== "tool_call" || item.status === "running") continue;
    const detail = item.detail;
    if (detail.type === "edit") {
      const diff =
        detail.unifiedDiff ??
        (detail.oldString || detail.newString ? `--- a/${detail.filePath}\n+++ b/${detail.filePath}\n-${detail.oldString ?? ""}\n+${detail.newString ?? ""}` : undefined);
      edits.push({ type: "edit", filePath: detail.filePath, diff });
    } else if (detail.type === "write") {
      const diff = detail.content ? `+++ ${detail.filePath} (new file)\n${detail.content.split("\n").map((l) => `+${l}`).join("\n")}` : undefined;
      edits.push({ type: "write", filePath: detail.filePath, diff });
    }
  }
  return edits;
}

/**
 * 本轮的 diff（截断到 DIFF_BUDGET）+ 实际进入 diff 的文件列表。
 * 截断后只保留"diff 里真出现过的"文件，保证卡片上两者永远一致。
 */
function lastTurnDiffAndFiles(edits: ReturnType<typeof lastTurnEdits>): { diff: string; files: string[] } {
  const withDiff = edits.filter((e) => e.diff);
  const joined = withDiff.map((e) => e.diff as string).join("\n");
  const diff = joined.slice(0, DIFF_BUDGET);
  const files = [...new Set(withDiff.map((e) => e.filePath))].slice(0, 20);
  return { diff, files };
}

/** Extract a compact review state from the full agent timeline. */
export function buildTaskSummary(timeline: readonly AgentTimelineItem[]): TaskSummary {
  // 全部以"最近一次 user_message 之后"为本轮窗口，和 diff/changedFiles 同源，避免窗口错位。
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
  const { diff, files } = lastTurnDiffAndFiles(edits);

  const recentUsers = allUsers.slice(-6);
  const task = recentUsers[recentUsers.length - 1]?.slice(0, 400) ?? "";

  return {
    task,
    userMessages: recentUsers.map((m) => m.slice(0, 300)),
    // ponytail: 本轮 assistant 消息，单条超 4000 字符时保留开头；升级路径：调大上限。
    assistantMessages: assistantMessages.map((m) => (m.length > 4000 ? `${m.slice(0, 4000)}…(截断)` : m)),
    changedFiles: files,
    lastTurnDiff: diff,
    shellCommands,
    runningTools: runningTool,
    finalOutput: assistantMessages[assistantMessages.length - 1]?.trim() ?? "",
  };
}
