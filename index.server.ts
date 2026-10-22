import { registerHistoryCompare } from "./server/history-compare";
import { registerHistoryActions } from "./server/history-actions";
import { registerSessionHistory } from "./server/session-history";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { cancelVerificationRpc, reconcileVerificationRpc, openVerificationRpc, reviewAgentRpc } from "./shared/review";
import { llmSettings, verificationSettings, type LlmConfig } from "./shared/settings";
import { promptTemplateSettings } from "./shared/prompts";
import { queueReview, reviewAgent, type RunContext } from "./server/review/run-review";
import { openVerification, reconcileVerification, cancelVerification } from "./server/verification/verification";
import { captureWorktree, diffSnapshots, disposeSnapshot, type WorktreeSnapshot } from "./server/commit/snapshot";
import { replaceTurnSnapshot, takeTurnSnapshot } from "./server/commit/turn-snapshots";
import { clarifyRpc } from "./shared/clarify";
import { clarifyDraft } from "./server/clarify";
import { buildTaskSummary, isSessionControlCommand } from "./server/review/inspect";
import { isVerifierHookAgent, verifyWithPaseoProvider } from "./server/verification/verify";
import { registerWorkspaceCommit } from "./server/workspace-commit";
import { registerGitHistory } from "./server/git-history";
import { registerCommit } from "./server/commit/register-commit.ts";
import { registerEditDiff } from "./server/edit-diff";

export default function contribute(server: PluginServerContext) {
  registerWorkspaceCommit(server);
  registerSessionHistory(server);
  registerGitHistory(server);
  registerHistoryActions(server);
  registerHistoryCompare(server);
  registerEditDiff(server);
  const settings = server.registerSettings(llmSettings);
  const verifySettings = server.registerSettings(verificationSettings);
  const promptSettings = server.registerSettings(promptTemplateSettings);
  // Read host settings for each review so changes take effect immediately.
  async function llmConfig(): Promise<LlmConfig> {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`LLM settings invalid: ${state.error}`);
    return state.values;
  }
  async function templates() {
    const state = await promptSettings.read();
    if (state.status !== "ready") throw new Error(`提示词模板配置无效：${state.error}`);
    return state.values;
  }

  const resetCommitForTurn = registerCommit(server, async () => (await templates()).piCommit);

  const ctx = (paseo: PluginHandlerContext["paseo"]): RunContext => ({
    getLlmConfig: async () => ({ ...await llmConfig(), reviewPrompt: (await templates()).review }),
    verifyTask: async (agentId, request, control) => {
      const state = await verifySettings.read();
      if (state.status !== "ready") throw new Error(`验证配置无效：${state.error}`);
      return verifyWithPaseoProvider(paseo, agentId, state.values, request, control, (await templates()).verification);
    },
  });

  server.on("agent.turn_started", async (event) => {
    if (isVerifierHookAgent(event.agent)) return;
    await resetCommitForTurn(event.agent.id);
    try {
      const snapshot = await captureWorktree(event.agent.cwd);
      await replaceTurnSnapshot(event.agent.id, { turnId: event.turnId, snapshot });
      console.log("[vibe-review] turn-start snapshot saved:", event.agent.id, event.turnId);
    } catch (error) {
      console.warn("[vibe-review] turn-start snapshot unavailable:", error);
    }
  });

  server.on("agent.turn_ended", async (event, context) => {
    if (isVerifierHookAgent(event.agent)) return;
    console.log("[vibe-review] turn_ended", event.agent.id, event.outcome.kind);
    let started: { turnId: string | null; snapshot: WorktreeSnapshot } | undefined;
    try {
      started = await takeTurnSnapshot(event.agent.id);
    } catch (error) {
      console.warn("[vibe-review] stored turn snapshot unavailable:", error);
    }
    if (isSessionControlCommand(buildTaskSummary(event.timeline).task)) {
      if (started) await disposeSnapshot(started.snapshot);
      console.log("[vibe-review] skipped session control command:", event.agent.id, event.turnId);
      return;
    }
    let fileChanges: { diff: string; fullDiff?: string; diffIncomplete: boolean } | undefined;
    if (started && started.turnId === event.turnId) {
      try {
        const ended = await captureWorktree(event.agent.cwd, started.snapshot);
        const diff = await diffSnapshots(started.snapshot, ended);
        const fullDiff = diff ? await diffSnapshots(started.snapshot, ended, true) : "";
        fileChanges = { diff, fullDiff, diffIncomplete: /Binary files .* differ|^GIT binary patch/m.test(diff) };
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
    // Runtime hook agents may carry labels that the SDK hook type does not expose.
    const labels = (event.agent as { labels?: Record<string, string> }).labels;
    const outcome =
      event.outcome.kind === "failed"
        ? { kind: "failed", error: event.outcome.error }
        : event.outcome.kind === "canceled"
          ? { kind: "canceled", error: { message: event.outcome.reason } }
        : undefined;
    queueReview(context.paseo, event.agent.id, event.timeline, event.turnId, labels, ctx(context.paseo), outcome, fileChanges);
  });

  server.handle(reviewAgentRpc, async ({ agentId }, context) => {
    await reviewAgent(agentId, context, ctx(context.paseo));
    return { ok: true as const };
  });

  server.handle(cancelVerificationRpc, async ({ agentId, scoredAt }, context) => {
    await cancelVerification(context.paseo, agentId, scoredAt);
    return { ok: true as const };
  });

  server.handle(reconcileVerificationRpc, async ({ agentId, scoredAt }, context) => {
    await reconcileVerification(context.paseo, agentId, scoredAt);
    return { ok: true as const };
  });

  server.handle(openVerificationRpc, async ({ agentId, scoredAt }, context) =>
    openVerification(context.paseo, agentId, scoredAt));

  server.handle(clarifyRpc, async ({ agentId, text }, context) => {
    const payload = await context.paseo.agents.ref(agentId).timeline.refetch();
    const items = payload.entries ?? [];
    const recent = items
      .map(({ item }) => item)
      .filter((item) => item.type === "user_message" || item.type === "assistant_message")
      .slice(-6)
      .map((item) => `${item.type === "user_message" ? "用户" : "助手"}: ${item.text}`);
    return clarifyDraft(await llmConfig(), text, recent);
  });

  // Paseo requires every contribution to return a cleanup function.
  return () => {};
}
