import { test } from "node:test";
import assert from "node:assert/strict";
import { menuPosition, nextMenuIndex } from "./context-menu-model.ts";

test("menu stays within viewport at edges and in narrow windows", () => {
  assert.deepEqual(menuPosition({ x: 990, y: 790 }, { width: 1000, height: 800 }, { width: 260, height: 180 }), { left: 732, top: 612 });
  assert.deepEqual(menuPosition({ x: -3, y: -4 }, { width: 300, height: 400 }, { width: 284, height: 380 }), { left: 8, top: 8 });
});
test("keyboard navigation wraps and skips disabled items", () => {
  assert.equal(nextMenuIndex([true, false, true], 0, 1), 2);
  assert.equal(nextMenuIndex([true, false, true], 0, -1), 2);
  assert.equal(nextMenuIndex([true, false, true], 2, 1), 0);
  assert.equal(nextMenuIndex([false, false], 0, 1), -1);
  assert.equal(nextMenuIndex([], -1, 1), -1);
});
