import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reviewAgentRpc } from "./shared/review";
import { llmSettings, type LlmConfig } from "./shared/settings";
import { queueReview, reviewAgent, type RunContext } from "./server/review";
import { captureWorktree, diffSnapshots, disposeSnapshot, type WorktreeSnapshot } from "./server/snapshot";
import { replaceTurnSnapshot, takeTurnSnapshot } from "./server/turn-snapshots";
import { clarifyRpc } from "./shared/clarify";
import { clarifyDraft } from "./server/clarify";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(llmSettings);

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
    try {
      const snapshot = await captureWorktree(event.agent.cwd);
      await replaceTurnSnapshot(event.agent.id, { turnId: event.turnId, snapshot });
      console.log("[vibe-review] turn-start snapshot saved:", event.agent.id, event.turnId);
    } catch (error) {
      console.warn("[vibe-review] turn-start snapshot unavailable:", error);
    }
  });

  server.on("agent.turn_ended", async (event, context) => {
    console.log("[vibe-review] turn_ended", event.agent.id, event.outcome.kind);
    let started: { turnId: string | null; snapshot: WorktreeSnapshot } | undefined;
    try {
      started = await takeTurnSnapshot(event.agent.id);
    } catch (error) {
      console.warn("[vibe-review] stored turn snapshot unavailable:", error);
    }
    let fileChanges: { diff: string; diffIncomplete: boolean } | undefined;
    if (started && started.turnId === event.turnId) {
      try {
        const diff = await diffSnapshots(started.snapshot, await captureWorktree(event.agent.cwd, started.snapshot));
        fileChanges = { diff, diffIncomplete: /Binary files .* differ|^GIT binary patch/m.test(diff) };
        console.log("[vibe-review] turn snapshot compared:", event.agent.id, event.turnId, "diff bytes", diff.length);
      } catch (error) {
        console.warn("[vibe-review] turn-end snapshot unavailable:", error);
      } finally {
        await disposeSnapshot(started.snapshot);
      }
    } else if (started) {
      console.warn("[vibe-review] turn snapshot id mismatch:", started.turnId, event.turnId);
      await disposeSnapshot(started.snapshot);
    } else {
      console.warn("[vibe-review] turn-start snapshot missing for:", event.agent.id, event.turnId);
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

  server.handle(clarifyRpc, async ({ agentId, text }, context) => {
    const payload = await context.paseo.agents.ref(agentId).timeline.refetch();
    const items = (payload as unknown as { entries?: Array<{ item: { type?: string; text?: string } }> }).entries ?? [];
    const recent = items
      .map(({ item }) => item)
      .filter((item) => (item.type === "user_message" || item.type === "assistant_message") && typeof item.text === "string")
      .slice(-6)
      .map((item) => `${item.type === "user_message" ? "用户" : "助手"}: ${item.text!.slice(0, 1000)}`);
    return clarifyDraft(await llmConfig(), text, recent);
  });

  return () => {};
}
