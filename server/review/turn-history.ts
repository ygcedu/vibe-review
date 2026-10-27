import type { PaseoAgentTimelineHandle } from "@getpaseo/client";

/** Turn-ended events no longer include history. Page back far enough to retain
 * the task even when a turn contains hundreds of tool calls. */
export async function fetchReviewHistory(timeline: Pick<PaseoAgentTimelineHandle, "refetch">) {
  let page = await timeline.refetch({ direction: "tail", limit: 200 });
  let entries = page.entries;
  const cursors = new Set<string>();
  while (page.hasOlder && page.startCursor && entries.filter(({ item }) => item.type === "user_message").length < 6) {
    const key = JSON.stringify(page.startCursor);
    if (cursors.has(key)) throw new Error("Review history cursor did not advance");
    cursors.add(key);
    const older = await timeline.refetch({ direction: "before", cursor: page.startCursor, limit: 200 });
    if (older.epoch !== page.epoch || older.staleCursor || older.gap) {
      throw new Error("Review history changed while loading; review skipped");
    }
    entries = [...older.entries, ...entries];
    page = older;
  }
  return entries.map(({ item }) => item);
}
