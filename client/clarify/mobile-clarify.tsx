import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { TextInput, copyText } from "@getpaseo/plugin/client/react-native";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { clarifyRpc } from "../../shared/clarify";

/** HACK(Paseo mobile): composer pills expose a draft, but not its selected range. */
type Draft = { getText(): string; replaceTextIfUnchanged(expected: string, replacement: string): boolean };
type Props = { close(): void; composerDraft?: Draft };
export function MobileClarify({ client, agentId, composerDraft, close }: Props & { client: PluginClientContext; agentId: string }) {
  const [original] = useState(() => composerDraft?.getText() ?? "");
  const [text, setText] = useState(original);
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    setSuggestion("");
    try {
      const result = await client.rpc(clarifyRpc, { agentId, text: text.trim() });
      setSuggestion(result.suggestion);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const adopt = () => {
    if (!composerDraft) {
      setError("当前 Paseo 客户端不支持替换草稿，请复制建议后粘贴到输入框。");
      return;
    }
    if (!composerDraft.replaceTextIfUnchanged(original, suggestion)) {
      setError("输入内容已变化，请重新打开建议。");
      return;
    }
    close();
  };

  return <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 10 }}>
    <Text style={{ fontSize: 14, lineHeight: 20, color: "#6b7280" }}>整理措辞，保留原意；建议不会自动发送。</Text>
    <TextInput
      multiline
      value={text}
      onChangeText={setText}
      placeholder="输入或粘贴要澄清的文字"
      placeholderTextColor="#9ca3af"
      textAlignVertical="top"
      accessibilityLabel="要澄清的文字"
      style={{ minHeight: 112, maxHeight: 160, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, lineHeight: 22, color: "#1f2937", backgroundColor: "#f9fafb" }}
    />
    <Pressable onPress={() => { void generate(); }} disabled={busy || !text.trim()} style={{ minHeight: 44, justifyContent: "center", borderRadius: 10, backgroundColor: busy || !text.trim() ? "#9ca3af" : "#176b42" }}>
      <Text style={{ color: "white", textAlign: "center", fontSize: 15, fontWeight: "600" }}>{busy ? "正在整理…" : "生成建议"}</Text>
    </Pressable>
    {!!suggestion && <View style={{ gap: 10, paddingTop: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: "#6b7280" }}>建议表达</Text>
      <Text selectable style={{ fontSize: 16, lineHeight: 23, color: "#1f2937" }}>{suggestion}</Text>
      <Pressable onPress={composerDraft ? adopt : () => { void copyText(suggestion).then(close, () => setError("复制失败，请长按建议文字复制。")); }} style={{ minHeight: 44, justifyContent: "center", borderRadius: 10, backgroundColor: "#176b42" }}>
        <Text style={{ color: "white", textAlign: "center", fontSize: 15, fontWeight: "600" }}>{composerDraft ? "采用建议" : "复制建议"}</Text>
      </Pressable>
    </View>}
    {!!error && <Text style={{ fontSize: 13, lineHeight: 19, color: "#b91c1c" }}>{error}</Text>}
  </View>;
}
