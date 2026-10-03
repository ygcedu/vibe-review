import { defineSettings, type SettingsDefinition } from "@getpaseo/plugin";
import { z } from "zod";

export const llmConfigSchema = z.object({
  /** OpenAI-compatible base URL, e.g. http://localhost:20128/v1 */
  baseUrl: z.string().default("http://localhost:20128/v1"),
  model: z.string().default("coding"),
  apiKey: z.string().default("sk-1feb0b9107bbfd84-0cblos-5a98fa2e"),
});

export type LlmConfig = z.infer<typeof llmConfigSchema>;

/** Server + client both need to address the same settings row by id. */
export const LLM_SETTINGS_ID = "vibe-review-llm";

export const llmSettings: SettingsDefinition<typeof llmConfigSchema> = defineSettings({
  id: LLM_SETTINGS_ID,
  scope: "host",
  version: 1,
  schema: llmConfigSchema,
});

export const piCommitConfigSchema = z.object({
  executable: z.string().default("pi"),
  provider: z.string().default(""),
  model: z.string().default(""),
});
export type PiCommitConfig = z.infer<typeof piCommitConfigSchema>;
export const piCommitSettings = defineSettings({
  id: "vibe-review-pi-commit",
  scope: "host",
  version: 1,
  schema: piCommitConfigSchema,
});
