export type ScrollPair = { before: number; after: number };

type Segment = { start: ScrollPair; end: ScrollPair; virtualStart: number; virtualEnd: number };

/** Corresponding diff landmarks form a shared scroll track. In a segment with
 * unequal heights, the shorter pane waits while the longer pane catches up. */
export function buildVerticalTrack(points: ScrollPair[]): Segment[] {
  const segments: Segment[] = [];
  let virtualStart = 0;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.max(0, end.before - start.before, end.after - start.after);
    if (length === 0) continue;
    segments.push({ start, end, virtualStart, virtualEnd: virtualStart + length });
    virtualStart += length;
  }
  return segments;
}

export function positionsAt(track: Segment[], position: number): ScrollPair {
  if (!track.length) return { before: 0, after: 0 };
  const segment = track.find((item) => position <= item.virtualEnd) ?? track[track.length - 1];
  const progress = Math.max(0, position - segment.virtualStart);
  return {
    before: segment.start.before + Math.min(progress, segment.end.before - segment.start.before),
    after: segment.start.after + Math.min(progress, segment.end.after - segment.start.after),
  };
}

export function positionForOffset(track: Segment[], side: keyof ScrollPair, offset: number): number {
  if (!track.length) return 0;
  const segment = track.find((item) => offset <= item.end[side]) ?? track[track.length - 1];
  const distance = segment.end[side] - segment.start[side];
  const progress = Math.max(0, Math.min(1, (offset - segment.start[side]) / Math.max(distance, 1)));
  return segment.virtualStart + progress * (segment.virtualEnd - segment.virtualStart);
}
