import { isNoDrift } from "../shared/drift.ts";
import type { DistilledTask } from "./distill.ts";

export interface ReviewResult {
  verdict: "pass" | "review" | "reject";
  completed: number;
  drift: "in_scope" | "minor_drift" | "major_drift";
  summary: string;
  scoredAt: string;
}

/** 大模型的 result 词映射成 completed 分数（完成度全由 LLM 判断）。 */
const RESULT_SCORE: Record<DistilledTask["result"], number> = {
  done: 1,
  partial: 0.5,
  none: 0,
  unknown: 0.5,
};

export function verdictOf(
  distilled: { drifts: string[]; result: DistilledTask["result"] },
): { verdict: ReviewResult["verdict"]; completed: number; drift: "in_scope" | "minor_drift" | "major_drift" } {
  const completed = RESULT_SCORE[distilled.result];
  const driftCount = distilled.drifts.filter((item) => !isNoDrift(item)).length;
  const drift: "in_scope" | "minor_drift" | "major_drift" =
    driftCount >= 2 ? "major_drift" : driftCount === 1 ? "minor_drift" : "in_scope";

  let verdict: ReviewResult["verdict"];
  if (drift === "major_drift" || distilled.result === "none") verdict = "reject";
  else if (drift === "minor_drift" || distilled.result !== "done") verdict = "review";
  else verdict = "pass";
  return { verdict, completed, drift };
}

/** Spawned task agents carry a `paseo.parent-agent-id` label; user's main session does not. */
const SPAWNED_LABEL = "paseo.parent-agent-id";
export function isSpawnedAgent(labels?: Record<string, string>): boolean {
  return Boolean(labels && labels[SPAWNED_LABEL]);
}
