import type { ComponentType } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsRow } from "@getpaseo/plugin/client/ui";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { llmSettings } from "../shared/settings";

/** 设置界面：OpenAI 兼容接口的 base url / model / api key。 */
export const LlmSettingsScreen: ComponentType<PluginSurfaceProps> = () => {
  const settings = useSettings(llmSettings);

  if (settings.status === "loading") return null;
  if (settings.status === "error" || settings.status === "invalid") {
    return <SettingsRow label="LLM 配置" error={settings.error} />;
  }

  const v = settings.values;
  const patch = (values: typeof v) => {
    void settings.save(values, settings.revision);
  };

  return (
    <>
      <SettingsCard>
        <SettingsRow label="Base URL" hint="OpenAI 兼容的 /v1 地址" error={settings.saveError}>
          <SettingsInput
            label="baseUrl"
            initialValue={v.baseUrl}
            placeholder="http://localhost:20128/v1"
            onChangeText={(text) => patch({ ...v, baseUrl: text })}
          />
        </SettingsRow>
        <SettingsRow label="Model" hint="模型名或别名">
          <SettingsInput
            label="model"
            initialValue={v.model}
            placeholder="coding"
            onChangeText={(text) => patch({ ...v, model: text })}
          />
        </SettingsRow>
        <SettingsRow label="API Key">
          <SettingsInput
            label="apiKey"
            initialValue={v.apiKey}
            placeholder="sk-..."
            secureTextEntry
            onChangeText={(text) => patch({ ...v, apiKey: text })}
          />
        </SettingsRow>
      </SettingsCard>
    </>
  );
};
