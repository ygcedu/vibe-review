import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { commitResultSchema } from "../shared/commit";

export function CommitResultItem(_props: PluginTimelineItemProps<z.infer<typeof commitResultSchema>>) {
  // Keep the timeline marker for recentCommitContext, but the preview card already shows the result.
  return null;
}
