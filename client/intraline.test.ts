import assert from "node:assert/strict";
import test from "node:test";
import { buildSplitDiffRows, type DiffLine } from "./diff.ts";
import { changedSpansByCell, changedTextSpans } from "./intraline.ts";

test("marks only the inserted expression inside a modified code line", () => {
  const before = "<Text style={styles.codeText}>";
  const after = "<Text allowFontScaling={false} style={styles.codeText}>";
  const marked = changedTextSpans(before, after).after.map(({ start, end }) => after.slice(start, end));
  assert.deepEqual(marked, ["allowFontScaling={false} "]);
});

test("keeps separate changes on one line separate", () => {
  const before = "const color = oldColor + oldShade;";
  const after = "const color = newColor + newShade;";
  const marked = changedTextSpans(before, after).after.map(({ start, end }) => after.slice(start, end));
  assert.deepEqual(marked, ["newColor", "newShade"]);
});

test("marks removed code only on the old side", () => {
  const before = "<Text selectable allowFontScaling={false} style={styles.codeText}>";
  const after = "<Text selectable style={styles.codeText}>";
  const spans = changedTextSpans(before, after);
  assert.deepEqual(spans.before.map(({ start, end }) => before.slice(start, end)), ["allowFontScaling={false} "]);
  assert.deepEqual(spans.after, []);
});

test("pairs later related lines after an inserted line", () => {
  const lines: DiffLine[] = [
    { type: "remove", content: "-const first = oldValue;" },
    { type: "remove", content: "-const second = oldValue;" },
    { type: "add", content: "+const first = newValue;" },
    { type: "add", content: "+const inserted = true;" },
    { type: "add", content: "+const second = newValue;" },
  ];
  const row = buildSplitDiffRows(lines)[0];
  assert.equal(row.kind, "change");
  if (row.kind !== "change") return;
  const marked = changedSpansByCell([row]);
  assert.deepEqual(marked.get(row.after[0])?.map(({ start, end }) => row.after[0].text.slice(start, end)), ["newValue"]);
  assert.deepEqual(marked.get(row.after[1]), [{ start: 0, end: row.after[1].text.length }]);
  assert.deepEqual(marked.get(row.after[2])?.map(({ start, end }) => row.after[2].text.slice(start, end)), ["newValue"]);
  assert.deepEqual(marked.get(row.before[1])?.map(({ start, end }) => row.before[1].text.slice(start, end)), ["oldValue"]);
});
