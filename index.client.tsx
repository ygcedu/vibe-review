import type { PluginClientContext } from "@getpaseo/plugin/client";
import { REVIEW_KIND, REVIEW_VERSION, reviewResultSchema, reviewAgentRpc } from "./shared/review";
import { ReviewResultItem } from "./client/review";
import { LlmSettingsScreen } from "./client/settings";

export default function contribute(client: PluginClientContext) {
  client.addTimelineRenderer({
    kind: REVIEW_KIND,
    version: REVIEW_VERSION,
    schema: reviewResultSchema,
    Component: ReviewResultItem,
  });

  client.addCommandCenterItem({
    id: "laya-review",
    title: "审核任务完成情况",
    icon: "Gauge",
    context: "agent",
    async onSelect({ agent, rpc }) {
      await rpc(reviewAgentRpc, { agentId: agent.id });
    },
  });

  client.addSettingsScreen({
    id: "laya-vibe-review-settings",
    title: "Laya Vibe Review",
    icon: "Gauge",
    Component: LlmSettingsScreen,
  });

  return () => {};
}
