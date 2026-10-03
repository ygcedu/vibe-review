import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { cancelPiCommitRpc, commitPreviewSchema, confirmPiCommitRpc, getPiCommitPreviewRpc } from "../shared/commit";
import { parseDiffFiles } from "./diff";
import { FileTree } from "./file-tree";

export function CommitPreviewItem({ item, agentId }: PluginTimelineItemProps<z.infer<typeof commitPreviewSchema>>) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const getPreview = useRpc(getPiCommitPreviewRpc);
  const getPreviewRef = useRef(getPreview);
  getPreviewRef.current = getPreview;
  const confirm = useRpc(confirmPiCommitRpc);
  const cancel = useRpc(cancelPiCommitRpc);
  const { proposalId, message, files, promptPreview } = item.data;
  const submitted = /^已提交：([0-9a-f]{7,40})\s+([\s\S]+)$/.exec(done);

  useEffect(() => {
    let active = true;
    void getPreviewRef.current({ agentId, proposalId }).then(
      (result) => { if (active) { if (result.result) setDone(result.result); else setDiff(result.diff); } },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { active = false; };
  }, [agentId, proposalId]);

  const submit = () => {
    if (busy || !diff) return;
    setBusy(true);
    void confirm({ agentId, proposalId }).then(
      (result) => setDone(`已提交：${result.summary}`),
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    ).finally(() => setBusy(false));
  };
  const dismiss = () => {
    if (busy) return;
    setBusy(true);
    void cancel({ agentId, proposalId }).then(
      () => setDone("已取消提交。"),
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    ).finally(() => setBusy(false));
  };

  return <View style={styles.card}>
    {done ? submitted ? <>
      <Text selectable style={styles.done}>已提交 · {submitted[1]}</Text>
      <Text selectable style={styles.doneMessage}>{submitted[2]}</Text>
    </> : <Text selectable style={styles.done}>{done}</Text> : <>
      <Text style={styles.heading}>确认 Pi 提交</Text>
      <Text style={styles.label}>Commit message</Text>
      <Text selectable style={styles.message}>{message}</Text>
      <Text style={styles.files}>{files.length} 个文件 · 请展开查看具体 diff</Text>
      {diff === null && !error ? <Text style={styles.muted}>正在读取 diff…</Text> : null}
      {diff ? <View style={styles.diff}><FileTree files={parseDiffFiles(diff)} /></View> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity onPress={dismiss} disabled={busy} style={styles.cancel}><Text style={styles.cancelText}>取消</Text></TouchableOpacity>
        <TouchableOpacity onPress={submit} disabled={busy || !diff || Boolean(error)} style={[styles.confirm, (busy || !diff || error) ? styles.disabled : null]}><Text style={styles.confirmText}>{busy ? "处理中…" : "确认提交"}</Text></TouchableOpacity>
      </View>
    </>}
    {promptPreview ? <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={showPrompt ? "收起 Pi 提示词" : "查看 Pi 提示词"} onPress={() => setShowPrompt((value) => !value)} style={styles.promptToggle}>
        <Text style={styles.promptToggleText}>{showPrompt ? "收起 Pi 提示词" : "查看 Pi 提示词"}</Text>
      </TouchableOpacity>
      {showPrompt ? <ScrollView style={styles.promptBox} nestedScrollEnabled><Text selectable style={styles.promptText}>{promptPreview}</Text></ScrollView> : null}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { alignSelf: "stretch", backgroundColor: "#fff", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#d8dee6", padding: 14, gap: 10 },
  heading: { color: "#111827", fontSize: 15, fontWeight: "700" },
  label: { color: "#6b7280", fontSize: 11, fontWeight: "600" },
  message: { color: "#1f2937", fontSize: 13, lineHeight: 19 },
  files: { color: "#6b7280", fontSize: 12 },
  diff: { backgroundColor: "#f8fafc", borderRadius: 8, overflow: "hidden" },
  muted: { color: "#6b7280", fontSize: 12 },
  error: { color: "#b91c1c", fontSize: 12 },
  done: { color: "#166534", fontSize: 13 },
  doneMessage: { color: "#166534", fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  cancel: { minHeight: 36, paddingHorizontal: 15, justifyContent: "center", borderRadius: 8, backgroundColor: "#f3f4f6" },
  cancelText: { color: "#374151", fontSize: 13, fontWeight: "600" },
  confirm: { minHeight: 36, paddingHorizontal: 15, justifyContent: "center", borderRadius: 8, backgroundColor: "#4f46e5" },
  confirmText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.55 },
  promptToggle: { alignSelf: "flex-start", paddingVertical: 4 },
  promptToggleText: { color: "#4f46e5", fontSize: 12, fontWeight: "600" },
  promptBox: { maxHeight: 320, backgroundColor: "#f8fafc", borderRadius: 8, padding: 10 },
  promptText: { color: "#374151", fontFamily: "monospace", fontSize: 11, lineHeight: 17 },
});
