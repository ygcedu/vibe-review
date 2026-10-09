import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { COMMIT_RESULT_KIND, commitResultSchema } from "../shared/commit.ts";
import { REVIEW_KIND, reviewResultSchema } from "../shared/review.ts";

/** Only recent review cards for turns with recorded file changes inform the commit. */
export function recentCommitContext(timeline: readonly AgentTimelineItem[]): string {
  const previousPiCommit = timeline.findLastIndex((item) => item.type === "plugin" && item.kind === COMMIT_RESULT_KIND && commitResultSchema.safeParse(item.data).data?.ok === true);
  const reviews = timeline.slice(previousPiCommit + 1)
    .flatMap((item) => item.type === "plugin" && item.kind === REVIEW_KIND ? [item.data] : [])
    .map((data) => reviewResultSchema.safeParse(data))
    .flatMap((result) => result.success && result.data.diff?.trim() ? [result.data] : [])
    .slice(-3);
  if (!reviews.length) return "";
  return reviews.map((data, index) => {
    return `${index + 1}. 任务目标：${data.goal || data.summary}\n` +
      `执行结果：${data.narrative || data.result || "未提供"}`;
  }).join("\n");
}
