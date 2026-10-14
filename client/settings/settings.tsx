import { useState, type ComponentType } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { llmSettings, piCommitSettings, verificationSettings } from "../../shared/settings";
import { promptTemplateSettings, DEFAULT_REVIEW_PROMPT, DEFAULT_VERIFICATION_PROMPT, DEFAULT_PI_COMMIT_PROMPT, promptEditableParts, type PromptKind } from "../../shared/prompts";
import { PromptTemplateEditor } from "./prompt-template-editor";

type Page = "review" | "verification" | "pi" | "prompts";
const pages: { id: Page; label: string }[] = [
  { id: "review", label: "评估" },
  { id: "verification", label: "验证" },
  { id: "pi", label: "Pi 提交" },
  { id: "prompts", label: "提示词" },
];
const templates: { id: PromptKind; label: string; defaultValue: string }[] = [
  { id: "review", label: "评估", defaultValue: DEFAULT_REVIEW_PROMPT },
  { id: "verification", label: "验证", defaultValue: DEFAULT_VERIFICATION_PROMPT },
  { id: "piCommit", label: "Pi commit", defaultValue: DEFAULT_PI_COMMIT_PROMPT },
];

function ChoiceTabs<T extends string>({ items, selected, onSelect, compact = false }: { items: { id: T; label: string }[]; selected: T; onSelect(id: T): void; compact?: boolean }) {
  const dark = useColorScheme() === "dark";
  return <View accessibilityRole="tablist" style={compact
    ? { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 18 }
    : { flexDirection: "row", borderRadius: 10, padding: 4, backgroundColor: dark ? "#1e293b" : "#f1f3f7", marginBottom: 28 }}>
    {items.map((item) => {
      const active = item.id === selected;
      return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={item.label}
        onPress={() => onSelect(item.id)} style={compact
          ? { minHeight: 36, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: 7,
              backgroundColor: active ? (dark ? "#26324a" : "#eeedff") : "transparent" }
          : { minHeight: 42, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 7, backgroundColor: active ? (dark ? "#334155" : "#fff") : "transparent" }}>
        <Text style={{ color: active ? (compact ? (dark ? "#c7d2fe" : "#4338ca") : (dark ? "#f8fafc" : "#1e293b")) : (dark ? "#94a3b8" : "#64748b"),
          fontSize: compact ? 13 : 14, fontWeight: active ? "700" : "500" }}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export const LlmSettingsScreen: ComponentType<PluginSurfaceProps> = () => {
  const llm = useSettings(llmSettings);
  const verification = useSettings(verificationSettings);
  const pi = useSettings(piCommitSettings);
  const prompts = useSettings(promptTemplateSettings);
  const [page, setPage] = useState<Page>("review");
  const [template, setTemplate] = useState<PromptKind>("review");
  const [drafts, setDrafts] = useState<Partial<Record<PromptKind, string[]>>>({});

  return <View style={{ paddingTop: 12 }}>
    <ChoiceTabs<Page> items={pages} selected={page} onSelect={setPage} />

    {page === "review" && (llm.status === "ready" ? <SettingsSection title="评估模型" info="用于每轮任务的总结、完成判断和后续建议">
      <SettingsCard>
        <SettingsInput label="服务地址" error={llm.saveError} initialValue={llm.values.baseUrl} placeholder="http://localhost:20128/v1"
          onChangeText={(baseUrl) => { void llm.save({ ...llm.values, baseUrl }, llm.revision); }} />
        <SettingsInput label="模型" initialValue={llm.values.model} placeholder="coding"
          onChangeText={(model) => { void llm.save({ ...llm.values, model }, llm.revision); }} />
        <SettingsInput label="API Key" initialValue={llm.values.apiKey} placeholder="sk-..." secureTextEntry
          onChangeText={(apiKey) => { void llm.save({ ...llm.values, apiKey }, llm.revision); }} />
      </SettingsCard>
    </SettingsSection> : llm.status === "error" || llm.status === "invalid" ? <SettingsRow label="评估模型" error={llm.error} /> : null)}

    {page === "verification" && (verification.status === "ready" ? <SettingsSection title="独立验证" info="由单独的 Agent 设计并执行测试用例">
      <SettingsCard>
        <SettingsSwitch label="自动验证" error={verification.saveError} value={verification.values.enabled}
          onValueChange={(enabled) => { void verification.save({ ...verification.values, enabled }, verification.revision); }} />
        {verification.values.enabled ? <>
          <SettingsInput label="Provider" initialValue={verification.values.provider} placeholder="codex"
            onChangeText={(provider) => { void verification.save({ ...verification.values, provider }, verification.revision); }} />
          <SettingsInput label="模型" initialValue={verification.values.model} placeholder="gpt-6-sol"
            onChangeText={(model) => { void verification.save({ ...verification.values, model }, verification.revision); }} />
          <SettingsInput label="权限模式" initialValue={verification.values.modeId} placeholder="full-access"
            onChangeText={(modeId) => { void verification.save({ ...verification.values, modeId }, verification.revision); }} />
        </> : null}
      </SettingsCard>
    </SettingsSection> : verification.status === "error" || verification.status === "invalid" ? <SettingsRow label="独立验证" error={verification.error} /> : null)}

    {page === "pi" && (pi.status === "ready" ? <SettingsSection title="Pi 提交" info="生成预览后由你确认提交">
      <SettingsCard>
        <SettingsInput label="可执行文件" error={pi.saveError} initialValue={pi.values.executable} placeholder="pi"
          onChangeText={(executable) => { void pi.save({ ...pi.values, executable }, pi.revision); }} />
        <SettingsInput label="Provider" initialValue={pi.values.provider} placeholder="例如 openai-codex"
          onChangeText={(provider) => { void pi.save({ ...pi.values, provider }, pi.revision); }} />
        <SettingsInput label="模型" initialValue={pi.values.model} placeholder="留空使用 Pi 默认模型"
          onChangeText={(model) => { void pi.save({ ...pi.values, model }, pi.revision); }} />
      </SettingsCard>
    </SettingsSection> : pi.status === "error" || pi.status === "invalid" ? <SettingsRow label="Pi 提交" error={pi.error} /> : null)}

    {page === "prompts" && (prompts.status === "ready" ? <SettingsSection title="提示词模板" info="选择一类任务，调整实际发送给模型的完整模板">
      <ChoiceTabs<PromptKind> items={templates} selected={template} onSelect={setTemplate} compact />
      {templates.filter((item) => item.id === template).map((item) => <PromptTemplateEditor key={item.id} kind={item.id} label={item.label}
          value={prompts.values[item.id]} draft={drafts[item.id] ?? promptEditableParts(item.id, prompts.values[item.id]) ?? []}
          onChange={(value) => setDrafts((current) => ({ ...current, [item.id]: value }))}
          defaultValue={item.defaultValue}
          onSave={async (value) => {
            await prompts.save({ ...prompts.values, [item.id]: value }, prompts.revision);
            setDrafts((current) => { const next = { ...current }; delete next[item.id]; return next; });
          }} />)}
      {prompts.saveError ? <Text style={{ color: "#dc2626", marginTop: 8 }}>{prompts.saveError}</Text> : null}
    </SettingsSection> : prompts.status === "error" || prompts.status === "invalid" ? <SettingsRow label="提示词模板" error={prompts.error} /> : null)}
  </View>;
};
