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

test("more menu aligns to button right edge and flips above near bottom", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 220, height: 160 };
  assert.deepEqual(menuPosition({ x: 900, y: 204, align: "end", aboveY: 168 }, viewport, size), { left: 680, top: 204 });
  assert.deepEqual(menuPosition({ x: 900, y: 754, align: "end", aboveY: 718 }, viewport, size), { left: 680, top: 558 });
});
