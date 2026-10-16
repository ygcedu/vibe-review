import assert from "node:assert/strict";
import test from "node:test";
import { completeChat } from "./llm-client.ts";

const config = { baseUrl: "http://model.test/v1", model: "test", apiKey: "test-key" };
const options = { maxTokens: 123, httpError: (status: number) => `request failed: ${status}` };

test("chat transport preserves request settings and tolerates trailing stream fragments", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "http://model.test/v1/chat/completions");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-key");
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: "test", messages: [{ role: "user", content: "prompt" }], max_tokens: 123, temperature: 0.1,
    });
    assert.ok(init.signal);
    return new Response('{"choices":[{"message":{"content":"answer"}}]}\ndata: [DONE]');
  });
  assert.equal(await completeChat(config, "prompt", { ...options, timeoutMs: 1000 }), "answer");
});

test("chat transport reports HTTP failures through the feature's own message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(completeChat(config, "prompt", options), /request failed: 503/);
});

test("chat transport rejects malformed content and accepts empty completions", async (t) => {
  let content = '{"choices":[{"message":{"content":42}}]}';
  t.mock.method(globalThis, "fetch", async () => new Response(content));
  await assert.rejects(completeChat(config, "prompt", options), /模型响应格式无效/);
  content = '{"choices":[]}';
  assert.equal(await completeChat(config, "prompt", options), "");
});
