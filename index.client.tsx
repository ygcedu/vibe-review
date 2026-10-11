import type { PluginClientContext } from "@getpaseo/plugin/client";
import { REVIEW_KIND, REVIEW_VERSION, reviewResultSchema, reviewAgentRpc } from "./shared/review";
import { ReviewResultItem } from "./client/review";
import { LlmSettingsScreen } from "./client/settings";
import { createClarifyController } from "./client/clarify";
import { MobileClarify } from "./client/mobile-clarify";
import { COMMIT_RESULT_KIND, COMMIT_PREVIEW_KIND, commitResultSchema, commitPreviewSchema, preparePiCommitRpc } from "./shared/commit";
import { CommitResultItem } from "./client/commit-result";
import { CommitPreviewItem } from "./client/commit-preview";
import { editDiffFiles } from "./client/edit-diff-data";
import { EDIT_DIFF_KIND, editDiffSchema, EditDiffItem } from "./client/edit-diff";
import { WorkspaceCommitPanel } from "./client/workspace-commit";
import { GitHistoryPanel } from "./client/git-history";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({ id: "vibe-review-commit", title: "提交更改", icon: "GitCommitHorizontal", context: "workspace", locations: ["explorer"], Component: WorkspaceCommitPanel });
  client.addWorkspacePanel({ id: "vibe-review-git-history", title: "Git 历史", icon: "GitBranch", context: "workspace", locations: ["workspace", "explorer"], Component: GitHistoryPanel });
  const clarify = createClarifyController(client);
  const pills = new Map<string, { workspaceId: string; remove(): void }>();
  const lifetime = new AbortController();
  const registerPill = (agent: { id: string; workspaceId?: string | null }) => {
    if (agent.workspaceId && pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    pills.get(agent.id)?.remove();
    pills.delete(agent.id);
    if (!agent.workspaceId || lifetime.signal.aborted) return;
    const registration = client.addComposerPill({
      id: "clarify-draft",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: "澄清表达",
        icon: "WandSparkles",
        label: "澄清表达",
        behavior: typeof document === "undefined"
          ? { kind: "popover", Content: (props) => <MobileClarify {...props} client={client} agentId={agent.id} /> }
          : { kind: "action", onPress: () => clarify.open(agent.id) },
      },
    });
    pills.set(agent.id, { workspaceId: agent.workspaceId, remove: registration.remove });
  };
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then((result: { subscription: { subscribe(callbacks: unknown): void } }) => {
    result.subscription.subscribe({
      snapshot: ({ entries }: { entries: Array<{ agent: { id: string; workspaceId?: string | null } }> }) => {
        for (const pill of pills.values()) pill.remove();
        pills.clear();
        for (const { agent } of entries) registerPill(agent);
      },
      update: (message: { type: string; payload: { kind: string; agent: { id: string; workspaceId?: string | null }; agentId: string } }) => {
        if (message.type !== "agent_update") return;
        if (message.payload.kind === "upsert") registerPill(message.payload.agent);
        else { pills.get(message.payload.agentId)?.remove(); pills.delete(message.payload.agentId); }
      },
    });
  }).catch((error: unknown) => { if (!lifetime.signal.aborted) console.error("Clarify pill registration failed", error); });
  client.addTimelineRenderer({
    kind: REVIEW_KIND,
    version: REVIEW_VERSION,
    schema: reviewResultSchema,
    Component: ReviewResultItem,
  });
  client.addTimelineRenderer({ kind: COMMIT_RESULT_KIND, version: 1, schema: commitResultSchema, Component: CommitResultItem });
  client.addTimelineRenderer({ kind: COMMIT_PREVIEW_KIND, version: 1, schema: commitPreviewSchema, Component: CommitPreviewItem });
  client.addTimelineTransformer({
    id: "edit-diff",
    query: { itemType: "tool_call" },
    transform({ item }) {
      if (!editDiffFiles(item) || item.detail.type !== "edit") return undefined;
      return { items: [{ type: "plugin", kind: EDIT_DIFF_KIND, version: 1,
        data: { path: item.detail.filePath, diff: item.detail.unifiedDiff!, status: item.status } }] };
    },
  });
  client.addTimelineRenderer({ kind: EDIT_DIFF_KIND, version: 1, schema: editDiffSchema, Component: EditDiffItem });

  const commit = async (agent: { id: string; cwd: string }, rpc: (contract: typeof preparePiCommitRpc, input: { agentId: string; cwd: string }) => Promise<unknown>) => {
    await rpc(preparePiCommitRpc, { agentId: agent.id, cwd: agent.cwd });
  };
  client.addSlashCommand({
    name: "commit",
    description: "预览 Pi 拟定的提交说明和文件 diff，确认后提交",
    argumentHint: "",
    context: "agent",
    async onSubmit({ agent, rpc }) { await commit(agent, rpc); },
  });
  client.addCommandCenterItem({
    id: "vibe-review-pi-commit",
    title: "预览 Pi 提交",
    icon: "GitCommitHorizontal",
    context: "agent",
    async onSelect({ agent, rpc }) { await commit(agent, rpc); },
  });

  client.addCommandCenterItem({
    id: "vibe-review",
    title: "审核任务完成情况",
    icon: "Gauge",
    context: "agent",
    async onSelect({ agent, rpc }) {
      await rpc(reviewAgentRpc, { agentId: agent.id });
    },
  });

  client.addSettingsScreen({
    id: "vibe-review-settings",
    title: "Vibe Review",
    icon: "Gauge",
    Component: LlmSettingsScreen,
  });

  return () => { lifetime.abort(); for (const pill of pills.values()) pill.remove(); pills.clear(); clarify.dispose(); };
}
