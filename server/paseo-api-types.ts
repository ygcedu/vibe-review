import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface PaseoAgentTimelineHandle {
  append(item: {
    type: "plugin";
    id: string;
    kind: string;
    version: number;
    data: unknown;
  }): Promise<{ seq: number; epoch: string }>;
  refetch(requestId?: string): Promise<{ entries?: Array<{ item: AgentTimelineItem }> }>;
}

export interface PaseoAgentRef {
  readonly id: string;
  readonly timeline: PaseoAgentTimelineHandle;
  send(text: string, options?: object): Promise<void>;
  current(): { labels?: Record<string, string> } | null;
  refresh(requestId?: string): Promise<unknown>;
  archive(): Promise<{ archivedAt: string }>;
}

export interface PaseoApi {
  agents: {
    ref(id: string): PaseoAgentRef;
  };
}
