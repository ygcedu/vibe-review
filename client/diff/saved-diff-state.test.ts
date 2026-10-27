import assert from "node:assert/strict";
import { test } from "node:test";
import { savedDiffSchema, serializeSavedDiff } from "./saved-diff-state.ts";

test("opening a file does not repeatedly save unchanged state after schema parsing", () => {
  // openTab inserts source before path; Zod emits path before source.
  const live = { tabs: [{ id: "working:test.ts", source: "working", path: "test.ts", staged: false, status: "M" }], activeTabId: "working:test.ts" };
  const saved = savedDiffSchema.parse(live);
  assert.notEqual(JSON.stringify(live), JSON.stringify(saved));
  assert.equal(serializeSavedDiff(live), serializeSavedDiff(saved));
  let writes = 0;
  let persisted = savedDiffSchema.parse({ tabs: [], activeTabId: null });
  for (let render = 0; render < 100; render++) {
    if (serializeSavedDiff(live) !== serializeSavedDiff(persisted)) {
      writes++;
      persisted = savedDiffSchema.parse(live);
    }
  }
  assert.equal(writes, 1);
});

test("real changes to the file, staging selection or active tab still persist", () => {
  const state = { tabs: [{ source: "working", path: "test.ts", id: "working:test.ts", staged: false }], activeTabId: "working:test.ts" };
  const original = serializeSavedDiff(state);
  assert.notEqual(original, serializeSavedDiff({ ...state, activeTabId: null }));
  assert.notEqual(original, serializeSavedDiff({ ...state, tabs: [{ ...state.tabs[0], staged: true }] }));
  assert.notEqual(original, serializeSavedDiff({ tabs: [], activeTabId: null }));
});
