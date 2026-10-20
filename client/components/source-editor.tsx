import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { workspaceSourceRpc, workspaceSourceSaveRpc } from "../../shared/workspace-commit";

export function SourceEditor({ workspaceId, path, theme, onClose, onSaved }: { workspaceId: string; path: string; theme: PluginHostProps["theme"]; onClose(): void; onSaved(): void }) {
  const read = useRpc(workspaceSourceRpc);
  const save = useRpc(workspaceSourceSaveRpc);
  const [original, setOriginal] = useState("");
  const [content, setContent] = useState("");
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const colors = theme.colors;
  useEffect(() => {
    let active = true;
    void read({ workspaceId, path }).then((value) => { if (active) { setOriginal(value.content); setContent(value.content); setVersion(value.version); } }, (reason) => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, path]);
  const close = () => { if (busy) return; if (content !== original) setDiscard(true); else onClose(); };
  return <Modal title={`源码 · ${path}`} open onOpenChange={(open) => { if (!open) close(); }}><Modal.Content>
    {loading ? <Text style={{ color: colors.foregroundMuted }}>读取源码…</Text> : version ? <TextInput accessibilityLabel={`编辑源码 ${path}`} multiline value={content} onChangeText={setContent} editable={!busy} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 320, maxHeight: 600, fontFamily: "monospace", fontSize: 13, color: colors.foreground, backgroundColor: colors.surface0, borderColor: colors.border, borderWidth: 1, borderRadius: 6, padding: 12, textAlignVertical: "top" }} /> : null}
    {error ? <Text style={{ color: colors.statusDanger }}>{error}</Text> : null}
    {discard ? <View style={{ gap: 8 }}><Text style={{ color: colors.foreground }}>放弃尚未保存的修改？</Text><Pressable accessibilityRole="button" accessibilityLabel="放弃修改并关闭源码" onPress={onClose}><Text style={{ color: colors.statusDanger }}>放弃修改并关闭</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setDiscard(false)}><Text style={{ color: colors.accent }}>继续编辑</Text></Pressable></View> : null}
    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={{ padding: 10 }}><Text style={{ color: colors.foregroundMuted }}>关闭</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="保存源码" disabled={busy || !version || content === original} onPress={() => {
        setBusy(true); setError("");
        void save({ workspaceId, path, content, version }).then((value) => { setOriginal(content); setVersion(value.version); onSaved(); }, (reason) => setError(String(reason))).finally(() => setBusy(false));
      }} style={{ padding: 10, opacity: busy || !version || content === original ? 0.45 : 1 }}><Text style={{ color: colors.accent }}>{busy ? "保存中…" : "保存"}</Text></Pressable>
    </View>
  </Modal.Content></Modal>;
}
