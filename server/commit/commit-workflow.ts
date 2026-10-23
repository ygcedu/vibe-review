import type { RpcOutput } from "@getpaseo/plugin";
import type { piCommitStatusRpc } from "../../shared/commit.ts";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PiCommitConfig } from "../../shared/settings.ts";
import { COMMIT_PREVIEW_KIND, COMMIT_RESULT_KIND } from "../../shared/commit.ts";
import { preparePiCommit, confirmPiCommit, hasPendingCodeChanges, type CommitProposal } from "./pi-commit.ts";
import { loadCommitProposal, removeCommitProposal, saveCommitProposal } from "./commit-proposals.ts";
import { recentCommitContext } from "./commit-context.ts";
import { commitResultSummary, isCurrentCommitPreview, isLatestReviewTurn } from "./commit-availability.ts";

type Paseo = PluginHandlerContext["paseo"];
type Status = { kind: "preparing" | "ready" | "finished" | "failed"; stage: string; startedAt: number };
type Preparation = Status & { kind: "preparing"; diff?: string; publication?: Promise<void> };
type Settled = Status & { kind: "ready" | "finished" | "failed" };
type Applying = { kind: "applying"; startedAt: number };
type Resetting = { kind: "resetting"; startedAt: number; done: Promise<void> };
type Session = Preparation | Settled | Applying | Resetting;
const readyStage = "提交预览已生成，请查看下方卡片并确认。";
const defaults = { preparePiCommit, confirmPiCommit, hasPendingCodeChanges, loadCommitProposal, removeCommitProposal, saveCommitProposal };

/** One owner for preparation, preview lifetime and exclusive confirmation/cancellation. */
export class CommitWorkflow {
  private readonly sessions = new Map<string, Session>();
  private readonly io: typeof defaults;
  private readonly readConfig: () => Promise<{ config: PiCommitConfig; prompt: string }>;

  constructor(
    readConfig: () => Promise<{ config: PiCommitConfig; prompt: string }>,
    dependencies: Partial<typeof defaults> = {},
  ) {
    this.readConfig = readConfig;
    this.io = { ...defaults, ...dependencies };
  }

  private begin(agentId: string, session: Preparation | Applying): Session | undefined {
    const previous = this.sessions.get(agentId);
    if (previous?.kind === "preparing") throw new Error("Pi 已在这个会话中执行提交");
    if (previous?.kind === "applying") throw new Error("正在提交，请稍候。");
    if (previous?.kind === "resetting") throw new Error("正在清理上一轮提交预览，请稍后重试。");
    this.sessions.set(agentId, session);
    return previous;
  }

  private restore(agentId: string, session: Session, previous?: Session) {
    if (this.sessions.get(agentId) !== session) return;
    if (previous) this.sessions.set(agentId, previous);
    else this.sessions.delete(agentId);
  }

  private async readAgent(paseo: Paseo, agentId: string) {
    const ref = paseo.agents.ref(agentId);
    const agent = ref.current() ?? (await ref.refresh())?.agent;
    const payload = await ref.timeline.refetch();
    const entries = payload.entries ?? [];
    return { ref, agent, entries, items: entries.map(({ item }) => item) };
  }

  async prepare(paseo: Paseo, { agentId, cwd, scoredAt }: { agentId: string; cwd: string; scoredAt?: string }) {
    // Reserve before any await: two concurrent RPCs cannot both pass preflight.
    const session: Preparation = { kind: "preparing", stage: "正在读取待提交文件…", startedAt: Date.now() };
    const previous = this.begin(agentId, session);
    try {
      const { ref, agent, entries, items } = await this.readAgent(paseo, agentId);
      if (!agent || agent.cwd !== cwd) throw new Error("当前 agent 的工作目录已变化，请重试");
      if (scoredAt && (agent.activeTurn || !isLatestReviewTurn(entries, scoredAt))) throw new Error("这张审核卡片已不是最后一轮，请使用最新轮次的提交入口。");
      if (await this.io.loadCommitProposal(agentId)) throw new Error("请先确认或取消当前提交预览");
      const { config, prompt } = await this.readConfig();
      if (this.sessions.get(agentId) !== session) throw new Error("会话已进入新轮次，本次提交预览已取消。");
      const userMessageCount = items.filter((item) => item.type === "user_message").length;
      void this.generate(agentId, session, async () => {
        const proposal = await this.io.preparePiCommit(agentId, cwd, config, recentCommitContext(items),
          (stage) => { if (this.sessions.get(agentId) === session) session.stage = stage; },
          (diff) => { if (this.sessions.get(agentId) === session) session.diff = diff; }, prompt);
        const latest = await ref.timeline.refetch();
        if (ref.current()?.activeTurn || (latest.entries ?? []).filter(({ item }) => item.type === "user_message").length !== userMessageCount) {
          throw new Error("会话已进入新轮次，本次提交预览已取消。");
        }
        return proposal;
      }, ref.timeline);
      return { ok: true as const, summary: "Pi 正在准备提交说明和文件 diff；请在预览中确认后再提交。" };
    } catch (error) {
      this.restore(agentId, session, previous);
      throw error;
    }
  }

  private async generate(agentId: string, session: Preparation, prepare: () => Promise<CommitProposal>, timeline: ReturnType<Paseo["agents"]["ref"]>["timeline"]) {
    try {
      const proposal = await prepare();
      if (this.sessions.get(agentId) !== session) return;
      session.publication = this.publish(agentId, session, proposal, timeline);
      await session.publication;
    } catch (error) {
      const stage = error instanceof Error ? error.message : String(error);
      console.error("[vibe-review] Pi commit preview failed:", stage);
      if (this.sessions.get(agentId) === session) this.sessions.set(agentId, { kind: "failed", stage, startedAt: session.startedAt });
    }
  }

  private async publish(agentId: string, session: Preparation, proposal: CommitProposal, timeline: ReturnType<Paseo["agents"]["ref"]>["timeline"]) {
    let published = false;
    try {
      await this.io.saveCommitProposal(proposal);
      if (this.sessions.get(agentId) !== session) return;
      await timeline.append({
        type: "plugin", id: `vibe-review-pi-preview-${proposal.id}`, kind: COMMIT_PREVIEW_KIND, version: 1,
        data: { proposalId: proposal.id, message: proposal.message, files: proposal.files, promptPreview: proposal.promptPreview },
      });
      if (this.sessions.get(agentId) === session) {
        this.sessions.set(agentId, { kind: "ready", stage: readyStage, startedAt: session.startedAt });
        published = true;
      }
    } finally {
      if (!published) await this.io.removeCommitProposal(agentId, proposal.id);
    }
  }

  async status(agentId: string): Promise<RpcOutput<typeof piCommitStatusRpc>> {
    const session = this.sessions.get(agentId);
    if (session?.kind === "preparing") return { kind: session.kind, stage: session.stage, startedAt: session.startedAt, diffReady: Boolean(session.diff) };
    if (session?.kind === "resetting") return { kind: "preparing", stage: "正在清理上一轮提交预览…", startedAt: session.startedAt, diffReady: false };
    if (session?.kind === "applying") return { kind: "ready" as const, stage: readyStage, startedAt: session.startedAt, diffReady: false };
    if (!session || session.kind === "ready") {
      const proposal = await this.io.loadCommitProposal(agentId);
      if (this.sessions.get(agentId) !== session) return this.status(agentId);
      if (proposal) return { kind: "ready" as const, stage: readyStage, startedAt: session?.startedAt ?? proposal.expiresAt - 10 * 60_000, diffReady: false };
      if (session) {
        const expired: Settled = { kind: "failed", stage: "提交预览已过期，请重试。", startedAt: session.startedAt };
        this.sessions.set(agentId, expired);
        return { ...expired, diffReady: false };
      }
    }
    return { ...(session ?? { kind: "idle" as const, stage: "" }), diffReady: false };
  }

  pendingDiff(agentId: string) {
    const session = this.sessions.get(agentId);
    if (session?.kind !== "preparing" || !session.diff) throw new Error("当前待提交 diff 尚未准备好或已过期。");
    return { diff: session.diff };
  }

  async preview(paseo: Paseo, agentId: string, proposalId: string) {
    const { agent, items } = await this.readAgent(paseo, agentId);
    if (agent?.activeTurn || !isCurrentCommitPreview(items, proposalId)) return { state: "stale" as const };
    const result = commitResultSummary(items, proposalId);
    if (result) return { state: "finished" as const, result };
    const proposal = await this.io.loadCommitProposal(agentId, proposalId);
    return proposal ? { state: "pending" as const, diff: proposal.diff } : { state: "stale" as const };
  }

  async confirm(paseo: Paseo, agentId: string, proposalId: string, message: string) {
    return this.apply(paseo, agentId, proposalId, message);
  }

  async cancel(paseo: Paseo, agentId: string, proposalId: string) {
    await this.apply(paseo, agentId, proposalId);
    return { ok: true as const };
  }

  private async apply(paseo: Paseo, agentId: string, proposalId: string, message?: string) {
    const session: Applying = { kind: "applying", startedAt: Date.now() };
    const previous = this.begin(agentId, session);
    try {
      const proposal = await this.io.loadCommitProposal(agentId, proposalId);
      if (!proposal || proposal.agentId !== agentId) {
        if (message !== undefined) throw new Error("提交预览已失效，请重新生成。");
        return { ok: true as const, summary: "已取消提交。" };
      }
      const ref = paseo.agents.ref(agentId);
      if (message !== undefined) {
        const { agent, items } = await this.readAgent(paseo, agentId);
        if (agent?.cwd !== proposal.cwd) throw new Error("工作目录已变化，请重新生成提交预览。");
        if (agent.activeTurn || !isCurrentCommitPreview(items, proposalId)) throw new Error("这张提交预览已不是当前轮次，请重新生成。");
      }
      const summary = message === undefined ? "已取消提交。" : await this.io.confirmPiCommit({ ...proposal, message });
      await ref.timeline.append({
        type: "plugin", id: `vibe-review-pi-commit-${Date.now()}`, kind: COMMIT_RESULT_KIND, version: 1,
        data: { ok: message !== undefined, summary, proposalId },
      });
      await this.io.removeCommitProposal(agentId, proposalId);
      this.sessions.set(agentId, { kind: "finished", stage: message === undefined ? "提交预览已取消。" : "提交已完成。", startedAt: Date.now() });
      return { ok: true as const, summary };
    } finally {
      this.restore(agentId, session, previous);
    }
  }

  async availability(paseo: Paseo, agentId: string, scoredAt: string) {
    const session = this.sessions.get(agentId);
    if (session?.kind === "preparing" || session?.kind === "applying" || session?.kind === "resetting") return { available: false };
    const { agent, entries } = await this.readAgent(paseo, agentId);
    if (!agent?.cwd || agent.activeTurn || !isLatestReviewTurn(entries, scoredAt) || await this.io.loadCommitProposal(agentId)) return { available: false };
    try {
      return await this.io.hasPendingCodeChanges(agent.cwd) ? { available: true, cwd: agent.cwd } : { available: false, reason: "no_changes" as const };
    } catch {
      return { available: false };
    }
  }

  async resetForTurn(agentId: string): Promise<void> {
    const current = this.sessions.get(agentId);
    if (current?.kind === "resetting") return current.done;
    const resetting: Resetting = { kind: "resetting", startedAt: Date.now(), done: Promise.resolve() };
    // Keep Git confirmation locked; otherwise reserve cleanup before its first await.
    // Old generation callbacks lose ownership immediately. In-flight persistence
    // must finish before a new producer can write the same per-agent record.
    if (current?.kind !== "applying") this.sessions.set(agentId, resetting);
    resetting.done = (async () => {
      try {
        if (current?.kind === "preparing") await current.publication?.catch(() => {});
        const proposal = await this.io.loadCommitProposal(agentId);
        if (proposal) await this.io.removeCommitProposal(agentId, proposal.id);
      } catch (error) {
        console.warn("[vibe-review] stale Pi preview cleanup failed:", error);
      } finally {
        if (this.sessions.get(agentId) === resetting) this.sessions.delete(agentId);
      }
    })();
    return resetting.done;
  }
}
