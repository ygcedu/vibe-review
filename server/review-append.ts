import type { PaseoApi } from "./paseo-api-types";

export interface AppendableReviewItem {
  type: "plugin";
  id: string;
  kind: string;
  version: number;
  data: unknown;
}

function connectionLost(error: unknown): boolean {
  const value = error as { code?: string; message?: string };
  return value?.code === "DAEMON_CONNECTION_LOST" || /Transport (?:closed|not connected)|status: disconnected/i.test(value?.message ?? "");
}

/** A plugin session can reconnect during a long verification; retry only transport failures. */
export async function appendReviewWithRetry(paseo: PaseoApi, agentId: string, item: AppendableReviewItem, replace = false): Promise<{ seq: number; epoch: string } | null> {
  const agent = paseo.agents.ref(agentId);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0 && !replace) {
        const page = await agent.timeline.refetch();
        if (page.entries?.some(({ item: existing }) => existing.type === "plugin" && existing.id === item.id)) return null;
      }
      return await agent.timeline.append(item);
    } catch (error) {
      if (!connectionLost(error) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return null;
}
