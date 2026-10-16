import { z } from "zod";
import type { LlmConfig } from "../shared/settings.ts";
import { parseFirstJsonObject } from "./llm-response.ts";

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullish() }).optional(),
  })).optional(),
});

/** Both model features use the same non-streaming OpenAI-compatible transport. */
export async function completeChat(
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
  if (!response.ok) throw new Error(options.httpError(response.status));
  const parsed = completionSchema.safeParse(parseFirstJsonObject<unknown>(await response.text()));
  if (!parsed.success) throw new Error("模型响应格式无效");
  return parsed.data.choices?.[0]?.message?.content ?? "";
}
