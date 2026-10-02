import assert from "node:assert/strict";
import test from "node:test";
import { buildVerticalTrack, positionForOffset, positionsAt } from "./vertical-sync.ts";

test("the shorter pane waits while the longer pane crosses an unmatched span", () => {
  const track = buildVerticalTrack([
    { before: 0, after: 0 },
    { before: 100, after: 100 },
    { before: 500, after: 150 },
    { before: 600, after: 250 },
  ]);

  assert.deepEqual(positionsAt(track, 100), { before: 100, after: 100 });
  assert.deepEqual(positionsAt(track, 250), { before: 250, after: 150 });
  assert.deepEqual(positionsAt(track, 500), { before: 500, after: 150 });
  assert.deepEqual(positionsAt(track, 550), { before: 550, after: 200 });
  assert.equal(positionForOffset(track, "before", 250), 250);
  assert.equal(positionForOffset(track, "after", 200), 550);
});
