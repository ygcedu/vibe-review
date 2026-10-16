import { z } from "zod";
import type { LlmConfig } from "../shared/settings.ts";
import { parseFirstJsonObject } from "./llm-response.ts";

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullish() }).optional(),
  })).optional(),
});

/**
 * Both model features use the same non-streaming OpenAI-compatible transport.
 * Transient failures (network errors, 5xx, 429) are retried with backoff.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export async function completeChat(
  config: LlmConfig,
  prompt: string,
  options: { maxTokens: number; timeoutMs?: number; httpError: (status: number) => string },
): Promise<string> {
  if (!config.apiKey) throw new Error("未配置 API Key，请在插件设置中填写 LLM apiKey。");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    try {
      return await completeChatOnce(config, prompt, options);
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      const retryable = status !== undefined
        ? RETRYABLE_STATUS.has(status)
        : !(error instanceof Error && /HTTP \d{3}/.test(error.message));
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error("LLM 请求失败");
}

async function completeChatOnce(
  config: LlmConfig,
  prompt: string,
  options: { maxTokens: number; timeoutMs?: number; httpError: (status: number) => string },
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: options.maxTokens,
      temperature: 0.1,
    }),
  });
  if (!response.ok) {
    const error = new Error(options.httpError(response.status)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const parsed = completionSchema.safeParse(parseFirstJsonObject<unknown>(await response.text()));
  if (!parsed.success) throw new Error("模型响应格式无效");
  return parsed.data.choices?.[0]?.message?.content ?? "";
}
