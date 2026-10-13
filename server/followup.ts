import type { PaseoApi } from "./paseo-api-types.ts";
import { isSpawnedAgent } from "./verdict.ts";

/** Auto follow-up only for spawned task agents (labeled by Paseo), never the user's main session. */
const FOLLOWUP_COOLDOWN_MS = 10 * 60 * 1000;
const lastFollowupAt = new Map<string, number>();

/** Send an auto follow-up message to a spawned agent if cooldown allows. Returns true if sent. */
export async function maybeSendFollowup(
  paseo: PaseoApi,
  agentId: string,
  labels: Record<string, string> | undefined,
  verdict: "reject" | "review",
): Promise<boolean> {
  if (!isSpawnedAgent(labels)) {
    console.log(`[vibe-review] ${verdict} but agent is a main session; notifying only`);
    return false;
  }
  const last = lastFollowupAt.get(agentId) ?? 0;
  if (Date.now() - last < FOLLOWUP_COOLDOWN_MS) return false;
  lastFollowupAt.set(agentId, Date.now());

  const message =
    verdict === "reject"
      ? "审核判定：代码变更明显偏离原始任务目标。请回滚与任务无关的修改，聚焦原始目标，完成后重新自检。"
      : "审核判定：任务可能未完整完成或执行中出现异常。请自检：对照原始任务逐条确认交付物是否齐全、是否存在未修复的报错。";

  try {
    await paseo.agents.ref(agentId).send(message);
    console.log(`[vibe-review] sent follow-up (${verdict}) to ${agentId}`);
    return true;
  } catch (error) {
    console.error("[vibe-review] follow-up send failed:", error);
    return false;
  }
}
