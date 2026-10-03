import type { PluginClientContext } from "@getpaseo/plugin/client";
import { REVIEW_KIND, REVIEW_VERSION, reviewResultSchema, reviewAgentRpc } from "./shared/review";
import { ReviewResultItem } from "./client/review";
import { LlmSettingsScreen } from "./client/settings";
import { createClarifyController } from "./client/clarify";

export default function contribute(client: PluginClientContext) {
  const clarify = createClarifyController(client);
  const pills = new Map<string, { workspaceId: string; remove(): void }>();
  const lifetime = new AbortController();
  const registerPill = (agent: { id: string; workspaceId?: string | null }) => {
    if (agent.workspaceId && pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    pills.get(agent.id)?.remove();
    pills.delete(agent.id);
    if (!agent.workspaceId || lifetime.signal.aborted || typeof document === "undefined") return;
    const registration = client.addComposerPill({
      id: "clarify-draft",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: "澄清表达",
        icon: "WandSparkles",
        label: "澄清表达",
        behavior: { kind: "action", onPress: () => clarify.open(agent.id) },
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
