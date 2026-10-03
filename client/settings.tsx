import type { ComponentType } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { llmSettings, piCommitSettings, verificationSettings } from "../shared/settings";

/** 设置界面：OpenAI 兼容接口的 base url / model / api key。 */
export const LlmSettingsScreen: ComponentType<PluginSurfaceProps> = () => {
  const settings = useSettings(llmSettings);
  const pi = useSettings(piCommitSettings);
  const verification = useSettings(verificationSettings);

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
      {verification.status === "ready" ? (
        <SettingsCard>
          <SettingsRow label="验证任务" hint="待验证类任务结束后运行独立 Paseo Agent" error={verification.saveError}>
            <SettingsSwitch label="启用验证" value={verification.values.enabled}
              onValueChange={(enabled) => { void verification.save({ ...verification.values, enabled }, verification.revision); }} />
          </SettingsRow>
          <SettingsRow label="验证 Provider" hint="Paseo Provider ID；需支持 Browser 或 Computer 工具">
            <SettingsInput label="verificationProvider" initialValue={verification.values.provider} placeholder="codex"
              onChangeText={(provider) => { void verification.save({ ...verification.values, provider }, verification.revision); }} />
          </SettingsRow>
          <SettingsRow label="验证 Model" hint="所选 Provider 的模型 ID">
            <SettingsInput label="verificationModel" initialValue={verification.values.model} placeholder="gpt-6-sol"
              onChangeText={(model) => { void verification.save({ ...verification.values, model }, verification.revision); }} />
          </SettingsRow>
          <SettingsRow label="验证权限模式" hint="Provider 的模式 ID；默认 full-access。Codex 使用此模式时无需审批。">
            <SettingsInput label="verificationModeId" initialValue={verification.values.modeId} placeholder="full-access"
              onChangeText={(modeId) => { void verification.save({ ...verification.values, modeId }, verification.revision); }} />
          </SettingsRow>
        </SettingsCard>
      ) : verification.status === "error" || verification.status === "invalid" ? <SettingsRow label="验证配置" error={verification.error} /> : null}
      {pi.status === "ready" ? (
        <SettingsCard>
          <SettingsRow label="Pi 可执行文件" hint="用于 /commit；填写 pi 或绝对路径" error={pi.saveError}>
            <SettingsInput label="piExecutable" initialValue={pi.values.executable} placeholder="pi"
              onChangeText={(text) => { void pi.save({ ...pi.values, executable: text }, pi.revision); }} />
          </SettingsRow>
          <SettingsRow label="Pi Provider" hint="留空使用 Pi 默认配置">
            <SettingsInput label="piProvider" initialValue={pi.values.provider} placeholder="例如 openai-codex"
              onChangeText={(text) => { void pi.save({ ...pi.values, provider: text }, pi.revision); }} />
          </SettingsRow>
          <SettingsRow label="Pi Model" hint="留空使用 Pi 默认模型">
            <SettingsInput label="piModel" initialValue={pi.values.model} placeholder="模型 ID"
              onChangeText={(text) => { void pi.save({ ...pi.values, model: text }, pi.revision); }} />
          </SettingsRow>
        </SettingsCard>
      ) : pi.status === "error" || pi.status === "invalid" ? <SettingsRow label="Pi 配置" error={pi.error} /> : null}
    </>
  );
};
