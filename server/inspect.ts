import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface TaskSummary {
  task: string;
  userMessages: string[];
  assistantMessages: string[];
  /** 停在 running 的工具数；>0 说明 agent 中途断开会话。 */
  runningTools: number;
}

/** Session controls do not represent a task for the review model. */
export function isSessionControlCommand(text: string): boolean {
  return /^\s*\/(?:compact|model|models|clear|reset|new)(?=\s|$)/i.test(text.trim());
}

/** Extract a compact review state from the full agent timeline. */
export function buildTaskSummary(timeline: readonly AgentTimelineItem[]): TaskSummary {
  // 最近一次 user_message 之后是本轮对话窗口；文件变更另由轮次快照提供。
  const lastUserAt = timeline.reduce((acc, item, i) => (item.type === "user_message" ? i : acc), -1);
  const lastTurn = timeline.slice(lastUserAt + 1);

  const assistantMessages: string[] = [];
  let runningTool = 0;

  // 历史用户消息（最多 6 条）只用于理解目标上下文；最近 1 条即"本轮任务"。
  const allUsers: string[] = [];
  for (const item of timeline) {
    if (item.type === "user_message") allUsers.push(item.text);
  }

  for (const item of lastTurn) {
    if (item.type === "assistant_message") assistantMessages.push(item.text);
    if (item.type === "tool_call" && item.status === "running") runningTool++;
  }

  const recentUsers = allUsers.slice(-6);
  const task = recentUsers[recentUsers.length - 1]?.slice(0, 400) ?? "";

  return {
    task,
    userMessages: recentUsers.map((m) => m.slice(0, 300)),
    assistantMessages,
    runningTools: runningTool,
  };
}
