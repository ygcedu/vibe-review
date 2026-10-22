import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHistoryColumns, HISTORY_COLUMN_MINIMUMS, resizeHistoryColumns } from "./history-columns.ts";
const sum = (widths: number[]) => widths.reduce((total, width) => total + width, 0);

test("resizing internal boundaries only transfers width between adjacent columns", () => {
  const widths = fitHistoryColumns(800, [80, 450, 150, 120]);
  for (const boundary of [0, 1, 2]) {
    const next = resizeHistoryColumns(widths, boundary, 24);
    assert.equal(next[boundary], widths[boundary] + 24);
    assert.equal(next[boundary + 1], widths[boundary + 1] - 24);
    assert.equal(sum(next), sum(widths));
    for (const other of [0, 1, 2, 3]) if (other !== boundary && other !== boundary + 1) assert.equal(next[other], widths[other]);
  }
});

test("repeated dragging in either direction cannot move the table right edge", () => {
  let widths = fitHistoryColumns(800);
  for (const delta of [-200, 40, 5000, -5000, 20]) {
    for (const boundary of [0, 1, 2]) {
      widths = resizeHistoryColumns(widths, boundary, delta);
      assert.equal(sum(widths), 800);
      widths.forEach((width, index) => assert.ok(width >= HISTORY_COLUMN_MINIMUMS[index]));
    }
  }
});

test("viewport resizing refits custom widths without leaving blank space or overflowing", () => {
  const preferred = resizeHistoryColumns(fitHistoryColumns(800), 1, -60);
  assert.equal(sum(fitHistoryColumns(1000, preferred)), 1000);
  assert.equal(sum(fitHistoryColumns(500, preferred)), 500);
  assert.deepEqual(fitHistoryColumns(100, preferred), HISTORY_COLUMN_MINIMUMS);
});

test("the outermost right edge cannot resize columns", () => {
  const widths = fitHistoryColumns(800);
  assert.deepEqual(resizeHistoryColumns(widths, 3, 100), widths);
});
