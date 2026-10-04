import { useState, type ComponentType } from "react";
import { Pressable, Text, useColorScheme } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { llmSettings, piCommitSettings, verificationSettings } from "../shared/settings";

function SectionToggle({ expanded, onPress }: { expanded: boolean; onPress(): void }) {
  const dark = useColorScheme() === "dark";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "收起设置" : "展开设置"} onPress={onPress}
      hitSlop={8} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
      <Text style={{ color: dark ? "#a5b4fc" : "#4338ca", fontSize: 14, fontWeight: "600" }}>
        {expanded ? "收起" : "展开"}
      </Text>
    </Pressable>
  );
}

/** Keep the main review settings visible; tuck the less frequent provider details away. */
export const LlmSettingsScreen: ComponentType<PluginSurfaceProps> = () => {
  const settings = useSettings(llmSettings);
  const pi = useSettings(piCommitSettings);
  const verification = useSettings(verificationSettings);
  const [showVerification, setShowVerification] = useState(false);
  const [showPi, setShowPi] = useState(false);

  if (settings.status === "loading") return null;
  if (settings.status === "error" || settings.status === "invalid") {
    return <SettingsRow label="审核模型" error={settings.error} />;
  }

  const v = settings.values;
  const patch = (values: typeof v) => { void settings.save(values, settings.revision); };

  return (
    <>
      <SettingsSection title="审核模型" info="用于生成每轮任务总结、评估和追问建议">
        <SettingsCard>
          <SettingsInput label="服务地址" error={settings.saveError} initialValue={v.baseUrl}
            placeholder="http://localhost:20128/v1" onChangeText={(baseUrl) => patch({ ...v, baseUrl })} />
          <SettingsInput label="模型" initialValue={v.model} placeholder="coding"
            onChangeText={(model) => patch({ ...v, model })} />
          <SettingsInput label="API Key" initialValue={v.apiKey} placeholder="sk-..." secureTextEntry
            onChangeText={(apiKey) => patch({ ...v, apiKey })} />
        </SettingsCard>
      </SettingsSection>

      {verification.status === "ready" ? (
        <SettingsSection title="独立验证" info="由单独的 Paseo Agent 按任务检查界面、代码或功能"
          trailing={verification.values.enabled
            ? <SectionToggle expanded={showVerification} onPress={() => setShowVerification((value) => !value)} />
            : undefined}>
          <SettingsCard>
            <SettingsSwitch label="自动验证" error={verification.saveError} value={verification.values.enabled}
              onValueChange={(enabled) => { void verification.save({ ...verification.values, enabled }, verification.revision); }} />
            {verification.values.enabled && showVerification ? (
              <>
                <SettingsInput label="Provider" initialValue={verification.values.provider} placeholder="codex"
                  onChangeText={(provider) => { void verification.save({ ...verification.values, provider }, verification.revision); }} />
                <SettingsInput label="模型" initialValue={verification.values.model} placeholder="gpt-6-sol"
                  onChangeText={(model) => { void verification.save({ ...verification.values, model }, verification.revision); }} />
                <SettingsInput label="权限模式" initialValue={verification.values.modeId} placeholder="full-access"
                  onChangeText={(modeId) => { void verification.save({ ...verification.values, modeId }, verification.revision); }} />
              </>
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : verification.status === "error" || verification.status === "invalid"
        ? <SettingsSection title="独立验证"><SettingsCard><SettingsRow label="配置读取失败" error={verification.error} /></SettingsCard></SettingsSection>
        : null}

      {pi.status === "ready" ? (
        <SettingsSection title="Pi 提交" info="生成提交预览并确认提交时使用"
          trailing={<SectionToggle expanded={showPi} onPress={() => setShowPi((value) => !value)} />}>
          {showPi ? <SettingsCard>
            <SettingsInput label="可执行文件" error={pi.saveError} initialValue={pi.values.executable} placeholder="pi"
              onChangeText={(executable) => { void pi.save({ ...pi.values, executable }, pi.revision); }} />
            <SettingsInput label="Provider" initialValue={pi.values.provider} placeholder="例如 openai-codex"
              onChangeText={(provider) => { void pi.save({ ...pi.values, provider }, pi.revision); }} />
            <SettingsInput label="模型" initialValue={pi.values.model} placeholder="留空使用 Pi 默认模型"
              onChangeText={(model) => { void pi.save({ ...pi.values, model }, pi.revision); }} />
          </SettingsCard> : null}
        </SettingsSection>
      ) : pi.status === "error" || pi.status === "invalid"
        ? <SettingsSection title="Pi 提交"><SettingsCard><SettingsRow label="配置读取失败" error={pi.error} /></SettingsCard></SettingsSection>
        : null}
    </>
  );
};
