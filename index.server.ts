import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reviewAgentRpc } from "./shared/review";
import { llmSettings, type LlmConfig } from "./shared/settings";
import { queueReview, reviewAgent, type RunContext } from "./server/review";
import { captureWorktree, diffSnapshots, disposeSnapshot, type WorktreeSnapshot } from "./server/snapshot";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(llmSettings);
  const turnSnapshots = new Map<string, { turnId: string | null; snapshot: WorktreeSnapshot }>();

  /** ponytail: fresh read per review (settings are host-scoped and cheap); upgrade path: cache + subscribe(). */
  async function llmConfig(): Promise<LlmConfig> {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`LLM settings invalid: ${state.error}`);
    return state.values;
  }

  const ctx = (): RunContext => ({
    getLlmConfig: llmConfig,
  });

  server.on("agent.turn_started", async (event) => {
    const previous = turnSnapshots.get(event.agent.id);
    turnSnapshots.delete(event.agent.id);
    if (previous) await disposeSnapshot(previous.snapshot);
    try {
      const snapshot = await captureWorktree(event.agent.cwd);
      turnSnapshots.set(event.agent.id, { turnId: event.turnId, snapshot });
    } catch (error) {
      console.warn("[vibe-review] turn-start snapshot unavailable:", error);
    }
  });

  server.on("agent.turn_ended", async (event, context) => {
    console.log("[vibe-review] turn_ended", event.agent.id, event.outcome.kind);
    const started = turnSnapshots.get(event.agent.id);
    turnSnapshots.delete(event.agent.id);
    let fileChanges: { diff: string; diffIncomplete: boolean } | undefined;
    if (started && started.turnId === event.turnId) {
      try {
        const diff = await diffSnapshots(started.snapshot, await captureWorktree(event.agent.cwd, started.snapshot));
        fileChanges = { diff, diffIncomplete: /Binary files .* differ|^GIT binary patch/m.test(diff) };
      } catch (error) {
        console.warn("[vibe-review] turn-end snapshot unavailable:", error);
      } finally {
        await disposeSnapshot(started.snapshot);
      }
    } else if (started) {
      await disposeSnapshot(started.snapshot);
    }
    const labels = (event.agent as { labels?: Record<string, string> }).labels;
    const outcome =
      event.outcome.kind === "failed"
        ? { kind: "failed", error: event.outcome.error }
        : event.outcome.kind === "canceled"
          ? { kind: "canceled", error: { message: event.outcome.reason } }
        : undefined;
    queueReview(context.paseo, event.agent.id, event.timeline, event.turnId, labels, ctx(), outcome, fileChanges);
  });

  server.handle(reviewAgentRpc, async ({ agentId }, context) => {
    await reviewAgent(agentId, context, ctx());
    return { ok: true as const };
  });

  return () => {
    for (const { snapshot } of turnSnapshots.values()) void disposeSnapshot(snapshot);
    turnSnapshots.clear();
  };
}
