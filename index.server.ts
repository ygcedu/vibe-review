import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reviewAgentRpc } from "./shared/review";
import { llmSettings, type LlmConfig } from "./shared/settings";
import { queueReview, reviewAgent, type RunContext } from "./server/review";
import { newFilesSince, snapshotFiles, type FileSnapshot } from "./server/new-files";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(llmSettings);
  const fileSnapshots = new Map<string, FileSnapshot>();

  /** ponytail: fresh read per review (settings are host-scoped and cheap); upgrade path: cache + subscribe(). */
  async function llmConfig(): Promise<LlmConfig> {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`LLM settings invalid: ${state.error}`);
    return state.values;
  }

  const ctx = (): RunContext => ({
    getLlmConfig: llmConfig,
  });

  server.on("agent.turn_started", (event) => {
    const snapshot = snapshotFiles(event.agent.cwd);
    if (snapshot) fileSnapshots.set(event.agent.id, snapshot);
  });

  server.on("agent.turn_ended", (event, context) => {
    console.log("[vibe-review] turn_ended", event.agent.id, event.outcome.kind);
    const labels = (event.agent as { labels?: Record<string, string> }).labels;
    const outcome =
      event.outcome.kind === "failed"
        ? { kind: "failed", error: event.outcome.error }
        : event.outcome.kind === "canceled"
          ? { kind: "canceled", error: { message: event.outcome.reason } }
        : undefined;
    const snapshot = fileSnapshots.get(event.agent.id);
    fileSnapshots.delete(event.agent.id);
    const run = {
      ...ctx(),
      cwd: snapshot?.cwd,
      getNewFiles: () => snapshot ? newFilesSince(snapshot) : [],
    };
    queueReview(context.paseo, event.agent.id, event.timeline, event.turnId, labels, run, outcome);
  });

  server.handle(reviewAgentRpc, async ({ agentId }, context) => {
    await reviewAgent(agentId, context, ctx());
    return { ok: true as const };
  });

  return () => {};
}
