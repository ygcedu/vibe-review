import assert from "node:assert/strict";
import { test } from "node:test";
import { isSessionControlCommand } from "./inspect.ts";

test("skips session controls without hiding task slash commands", () => {
  for (const input of ["/compact", "  /compact  ", "/model gpt-6", "/models", "/clear", "/reset", "/new"]) {
    assert.equal(isSessionControlCommand(input), true, input);
  }
  for (const input of ["/review", "/goal finish this", "/compactness", "Please run /compact", "/modeling task"]) {
    assert.equal(isSessionControlCommand(input), false, input);
  }
});
