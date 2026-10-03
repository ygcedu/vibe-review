import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reviewAgentRpc, REVIEW_KIND } from "./shared/review";
import { llmSettings, piCommitSettings, type LlmConfig } from "./shared/settings";
import { queueReview, reviewAgent, type RunContext } from "./server/review";
import { captureWorktree, diffSnapshots, disposeSnapshot, type WorktreeSnapshot } from "./server/snapshot";
import { replaceTurnSnapshot, takeTurnSnapshot } from "./server/turn-snapshots";
import { clarifyRpc } from "./shared/clarify";
import { clarifyDraft } from "./server/clarify";
import { preparePiCommitRpc, piCommitStatusRpc, getPendingCommitDiffRpc, confirmPiCommitRpc, getPiCommitPreviewRpc, cancelPiCommitRpc, commitAvailabilityRpc, COMMIT_RESULT_KIND, COMMIT_PREVIEW_KIND } from "./shared/commit";
import { preparePiCommit, confirmPiCommit, hasPendingCodeChanges, type CommitProposal } from "./server/pi-commit";
import { recentCommitContext } from "./server/commit-context";
import { buildTaskSummary, isSessionControlCommand } from "./server/inspect";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(llmSettings);
  const piSettings = server.registerSettings(piCommitSettings);
  const activeCommits = new Set<string>();
  const activeConfirmations = new Set<string>();
  const proposals = new Map<string, CommitProposal>();
  const commitStatuses = new Map<string, { kind: "preparing" | "ready" | "failed"; stage: string; startedAt: number }>();
  const pendingDiffs = new Map<string, string>();
  const pendingProposal = (agentId: string) => {
    for (const [id, proposal] of proposals) {
      if (Date.now() > proposal.expiresAt) proposals.delete(id);
    }
    return [...proposals.values()].some((proposal) => proposal.agentId === agentId);
  };


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
    if (isSessionControlCommand(buildTaskSummary(event.timeline).task)) {
      if (started) await disposeSnapshot(started.snapshot);
      console.log("[vibe-review] skipped session control command:", event.agent.id, event.turnId);
      return;
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

  server.handle(preparePiCommitRpc, async ({ agentId, cwd }, context) => {
    const ref = context.paseo.agents.ref(agentId);
    const agent = ref.current() ?? (await ref.refresh())?.agent;
    if (!agent || agent.cwd !== cwd) throw new Error("当前 agent 的工作目录已变化，请重试");
    if (activeCommits.has(agentId)) throw new Error("Pi 已在这个会话中执行提交");
    if (pendingProposal(agentId)) throw new Error("请先确认或取消当前提交预览");
    const state = await piSettings.read();
    if (state.status !== "ready") throw new Error(`Pi 配置无效: ${state.error}`);
    activeCommits.add(agentId);
    pendingDiffs.delete(agentId);
    const startedAt = Date.now();
    commitStatuses.set(agentId, { kind: "preparing", stage: "正在读取待提交文件…", startedAt });
    void (async () => {
      try {
        const payload = await context.paseo.agents.ref(agentId).timeline.refetch();
        const timeline = (payload as unknown as { entries?: Array<{ item: import("@getpaseo/protocol/agent-types").AgentTimelineItem }> }).entries?.map(({ item }) => item) ?? [];
        const proposal = await preparePiCommit(agentId, cwd, state.values, recentCommitContext(timeline), (stage) => {
          commitStatuses.set(agentId, { kind: "preparing", stage, startedAt });
        }, (diff) => pendingDiffs.set(agentId, diff));
        proposals.set(proposal.id, proposal);
        try {
          await context.paseo.agents.ref(agentId).timeline.append({
            type: "plugin", id: `vibe-review-pi-preview-${proposal.id}`,
            kind: COMMIT_PREVIEW_KIND, version: 1,
            data: { proposalId: proposal.id, message: proposal.message, files: proposal.files },
          });
        } catch (error) {
          proposals.delete(proposal.id);
          throw error;
        }
        pendingDiffs.delete(agentId);
        commitStatuses.set(agentId, { kind: "ready", stage: "提交预览已生成，请查看下方卡片并确认。", startedAt });
      } catch (error) {
        const summary = error instanceof Error ? error.message : String(error);
        console.error("[vibe-review] Pi commit preview failed:", summary);
        commitStatuses.set(agentId, { kind: "failed", stage: summary, startedAt });
      } finally {
        activeCommits.delete(agentId);
      }
    })();
    return { ok: true as const, summary: "Pi 正在准备提交说明和文件 diff；请在预览中确认后再提交。" };
  });

  server.handle(piCommitStatusRpc, async ({ agentId }) => {
    const status = commitStatuses.get(agentId);
    if (status?.kind === "ready" && !pendingProposal(agentId)) {
      const expired = { kind: "failed" as const, stage: "提交预览已过期，请重试。", startedAt: status.startedAt };
      commitStatuses.set(agentId, expired);
      return { ...expired, diffReady: false };
    }
    return { ...(status ?? { kind: "idle" as const, stage: "" }), diffReady: pendingDiffs.has(agentId) };
  });
  server.handle(getPendingCommitDiffRpc, async ({ agentId }) => {
    const diff = pendingDiffs.get(agentId);
    if (!diff) throw new Error("当前待提交 diff 尚未准备好或已过期。");
    return { diff };
  });

  server.handle(getPiCommitPreviewRpc, async ({ agentId, proposalId }, context) => {
    const proposal = proposals.get(proposalId);
    if (!proposal || proposal.agentId !== agentId || Date.now() > proposal.expiresAt) {
      const payload = await context.paseo.agents.ref(agentId).timeline.refetch();
      const items = (payload as unknown as { entries?: Array<{ item: { type?: string; kind?: string; data?: { proposalId?: string; summary?: string; ok?: boolean } } }> }).entries?.map(({ item }) => item) ?? [];
      let result = items.findLast((item) => item.type === "plugin" && item.kind === COMMIT_RESULT_KIND && item.data?.proposalId === proposalId)?.data;
      // Older result rows had no proposalId. Associate only the first commit row
      // following this preview, and stop at the next preview to avoid mixing runs.
      if (!result) {
        const previewIndex = items.findIndex((item) => item.type === "plugin" && item.kind === COMMIT_PREVIEW_KIND && item.data?.proposalId === proposalId);
        if (previewIndex >= 0) {
          const next = items.slice(previewIndex + 1).find((item) => item.type === "plugin" && (item.kind === COMMIT_RESULT_KIND || item.kind === COMMIT_PREVIEW_KIND));
          if (next?.kind === COMMIT_RESULT_KIND && !next.data?.proposalId) result = next.data;
        }
      }
      if (result?.summary) return { diff: "", result: result.ok ? `已提交：${result.summary}` : result.summary };
      throw new Error("提交预览已失效，请重新生成。");
    }
    return { diff: proposal.diff };
  });

  server.handle(cancelPiCommitRpc, async ({ agentId, proposalId }, context) => {
    if (activeConfirmations.has(proposalId)) throw new Error("正在提交，请稍候。");
    const proposal = proposals.get(proposalId);
    if (proposal?.agentId === agentId) {
      proposals.delete(proposalId); commitStatuses.delete(agentId); pendingDiffs.delete(agentId);
      await context.paseo.agents.ref(agentId).timeline.append({ type: "plugin", id: `vibe-review-pi-commit-${Date.now()}`, kind: COMMIT_RESULT_KIND, version: 1, data: { ok: false, summary: "已取消提交。", proposalId } });
    }
    return { ok: true as const };
  });

  server.handle(confirmPiCommitRpc, async ({ agentId, proposalId }, context) => {
    const proposal = proposals.get(proposalId);
    if (!proposal || proposal.agentId !== agentId) throw new Error("提交预览已失效，请重新生成。");
    const ref = context.paseo.agents.ref(agentId);
    const agent = ref.current() ?? (await ref.refresh())?.agent;
    if (agent?.cwd !== proposal.cwd) throw new Error("工作目录已变化，请重新生成提交预览。");
    if (activeConfirmations.has(proposalId)) throw new Error("正在提交，请稍候。");
    activeConfirmations.add(proposalId);
    try {
      const summary = await confirmPiCommit(proposal);
      proposals.delete(proposalId);
      commitStatuses.delete(agentId);
      pendingDiffs.delete(agentId);
      await ref.timeline.append({ type: "plugin", id: `vibe-review-pi-commit-${Date.now()}`, kind: COMMIT_RESULT_KIND, version: 1, data: { ok: true, summary, proposalId } });
      return { ok: true as const, summary };
    } finally {
      activeConfirmations.delete(proposalId);
    }
  });

  server.handle(commitAvailabilityRpc, async ({ agentId, scoredAt }, context) => {
    const ref = context.paseo.agents.ref(agentId);
    const agent = ref.current() ?? (await ref.refresh())?.agent;
    if (!agent?.cwd || activeCommits.has(agentId)) return { available: false };
    if (pendingProposal(agentId)) return { available: false };
    const payload = await context.paseo.agents.ref(agentId).timeline.refetch();
    const items = (payload as unknown as { entries?: Array<{ item: { type?: string; kind?: string; data?: { scoredAt?: string } } }> }).entries?.map(({ item }) => item) ?? [];
    const latest = items.findLast((item) => item.type === "plugin" && item.kind === REVIEW_KIND);
    if (latest?.data?.scoredAt !== scoredAt) return { available: false };
    try {
      return await hasPendingCodeChanges(agent.cwd) ? { available: true, cwd: agent.cwd } : { available: false };
    } catch {
      return { available: false };
    }
  });

  return () => {};
}
