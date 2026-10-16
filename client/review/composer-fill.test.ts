import assert from "node:assert/strict";
import test from "node:test";
import { fillVisibleComposer } from "./composer-fill.ts";

// ponytail: minimal DOM stub for node --test; upgrade path: real DOM (jsdom) if coverage grows.
function makeInput(text: string, value: string) {
  return {
    text,
    value,
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
    dispatchEvent: () => {},
    focus: () => {},
    setSelectionRange: () => {},
  };
}

function setup(inputs: unknown[]) {
  // ponytail: capture the prototype value setter exactly as composer-fill.ts reads it.
  const proto = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (proto as any).value; // no-op
  Object.defineProperty(proto, "value", {
    set(this: { __v?: string }, v: string) { this.__v = v; },
    get(this: { __v?: string }) { return this.__v; },
    configurable: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeClass = { prototype: proto };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLTextAreaElement = fakeClass;
  const doc: Record<string, unknown> = {
    activeElement: null,
    querySelectorAll: () => inputs,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = doc;
  // Each input needs the value descriptor so setter.call(input, text) works.
  for (const input of inputs as { __v?: string }[]) {
    Object.defineProperty(input, "value", {
      set(this: { __v?: string }, v: string) { this.__v = v; },
      get(this: { __v?: string }) { return this.__v; },
      configurable: true,
    });
  }
  return { doc };
}

test("single pane: active element's pane has one visible input -> fills it", () => {
  const input = makeInput("a", "before");
  setup([input]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (globalThis as any).document as Record<string, unknown>;
  // ponytail: activeElement is the input's pane; pane-level querySelectorAll returns just that input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pane: any = {
    querySelectorAll: () => [input],
    parentElement: null,
  };
  doc.activeElement = pane;
  assert.equal(fillVisibleComposer("after"), true);
  assert.equal((input as { __v?: string }).__v, "after");
});

test("multiple panes: active pane has one visible input among two total -> fills the active one, not document-wide fallback", () => {
  const inputA = makeInput("a", "before");
  const inputB = makeInput("b", "before");
  setup([inputA, inputB]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (globalThis as any).document as Record<string, unknown>;
  // ponytail: active pane contains only inputB; document-wide has both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pane: any = {
    querySelectorAll: () => [inputB],
    parentElement: null,
  };
  doc.activeElement = pane;
  assert.equal(fillVisibleComposer("filled"), true);
  assert.equal((inputB as { __v?: string }).__v, "filled");
  assert.equal((inputA as { __v?: string }).__v, undefined);
});
