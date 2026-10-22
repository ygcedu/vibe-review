import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHistoryColumns, HISTORY_COLUMN_MINIMUMS, resizeHistoryColumns } from "./history-columns.ts";

test("each column can be resized independently without shifting widths of other columns", () => {
  const widths = fitHistoryColumns(800);
  for (const column of [0, 1, 2, 3]) {
    const resized = resizeHistoryColumns(widths, column, 36);
    assert.equal(resized[column], widths[column] + 36);
    for (const other of [0, 1, 2, 3]) if (other !== column) assert.equal(resized[other], widths[other]);
  }
});

test("dragging cannot collapse a column below its readable minimum", () => {
  const widths = fitHistoryColumns(800);
  for (const column of [0, 1, 2, 3]) assert.equal(resizeHistoryColumns(widths, column, -10000)[column], HISTORY_COLUMN_MINIMUMS[column]);
});

test("custom widths survive panel resizing and can overflow for horizontal scrolling", () => {
  const preferred = resizeHistoryColumns(fitHistoryColumns(800), 1, 100);
  assert.deepEqual(fitHistoryColumns(300, preferred), preferred);
  assert.deepEqual(fitHistoryColumns(1000, preferred), preferred);
});

test("narrow viewports start with readable widths, and every column can still grow", () => {
  const widths = fitHistoryColumns(100);
  assert.deepEqual(widths, HISTORY_COLUMN_MINIMUMS);
  for (const column of [0, 1, 2, 3]) assert.equal(resizeHistoryColumns(widths, column, 80)[column], widths[column] + 80);
});
