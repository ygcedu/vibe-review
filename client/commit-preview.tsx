import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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
  const [previewRequest, setPreviewRequest] = useState(0);
  const [previewState, setPreviewState] = useState<"loading" | "pending" | "finished" | "stale" | "unavailable">("loading");
  const [messageFocused, setMessageFocused] = useState(false);
  const getPreview = useRpc(getPiCommitPreviewRpc);
  const getPreviewRef = useRef(getPreview);
  getPreviewRef.current = getPreview;
  const confirm = useRpc(confirmPiCommitRpc);
  const cancel = useRpc(cancelPiCommitRpc);
  const { proposalId, message, files, promptPreview } = item.data;
  const [editedMessage, setEditedMessage] = useState(message);
  const validMessage = editedMessage.trim().length > 0 && editedMessage.trim().length <= 80;
  const submitted = /^已提交：([0-9a-f]{7,40})\s+([\s\S]+)$/.exec(done);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      void getPreviewRef.current({ agentId, proposalId }).then(
        (result) => {
          if (!active) return;
          setError("");
          setPreviewState(result.state);
          if (result.state === "finished") setDone(result.result ?? "已结束提交预览。");
          if (result.state === "pending") setDiff(result.diff ?? null);
        },
        (reason: unknown) => {
          if (!active) return;
          const message = reason instanceof Error ? reason.message : String(reason);
          if (attempt < 2 && /Transport closed|connection closed/i.test(message)) timer = setTimeout(() => load(attempt + 1), 500 * (attempt + 1));
          else { setPreviewState("unavailable"); setError(message); }
        },
      );
    };
    load(0);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [agentId, proposalId, previewRequest]);

  const groupNode = useRef<View>(null);
  // Skip the 3s poll while the card is off-screen (multi-card timelines);
  // re-poll immediately once visible again.
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = groupNode.current as unknown as HTMLElement | null;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) setIsVisible(entry.isIntersecting);
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (previewState !== "pending") return;
    let active = true;
    const refresh = () => {
      void getPreviewRef.current({ agentId, proposalId }).then((result) => {
        if (!active) return;
        if (result.state === "finished") {
          setDone(result.result ?? "已结束提交预览。");
          setPreviewState("finished");
        } else if (result.state === "stale") {
          setPreviewState("stale");
        } else if (result.diff) {
          setDiff(result.diff);
        }
      }, () => { /* Retain the visible preview and retry after reconnect. */ });
    };
    if (isVisible) refresh();
    if (!isVisible) return () => { active = false; };
    const timer = setInterval(refresh, 3_000);
    return () => { active = false; clearInterval(timer); };
  }, [agentId, proposalId, previewState, isVisible]);

  const submit = () => {
    if (busy || previewState !== "pending" || !diff || !validMessage) return;
    setBusy(true);
    void confirm({ agentId, proposalId, message: editedMessage.trim() }).then(
      (result) => { setDone(`已提交：${result.summary}`); setPreviewState("finished"); },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    ).finally(() => setBusy(false));
  };
  const dismiss = () => {
    if (busy) return;
    setBusy(true);
    void cancel({ agentId, proposalId }).then(
      () => { setDone("已取消提交。"); setPreviewState("finished"); },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    ).finally(() => setBusy(false));
  };

  const promptToggle = promptPreview ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={showPrompt ? "收起 commit 任务提示词" : "查看 commit 任务提示词"} onPress={() => setShowPrompt((value) => !value)} style={styles.promptToggle}>
    <Text style={styles.promptToggleText}>{showPrompt ? "收起 commit 任务提示词" : "查看 commit 任务提示词"}</Text>
  </TouchableOpacity> : null;

  if (previewState === "loading" || previewState === "stale") return null;
  if (previewState === "unavailable") return <View style={styles.card}>
    <Text style={styles.error}>暂时无法读取提交预览。{error}</Text>
    <TouchableOpacity accessibilityRole="button" onPress={() => { setError(""); setPreviewState("loading"); setPreviewRequest((value) => value + 1); }} style={styles.retry}>
      <Text style={styles.promptToggleText}>重新读取预览</Text>
    </TouchableOpacity>
  </View>;

  return <View ref={groupNode} style={styles.card}>
    {done ? submitted ? <>
      <Text selectable style={styles.done}>已提交 · {submitted[1]}</Text>
      <Text selectable style={styles.doneMessage}>{submitted[2]}</Text>
    </> : <Text selectable style={styles.done}>{done}</Text> : <>
      <Text style={styles.heading}>提交预览</Text>
      <Text style={styles.label}>Commit message</Text>
      <TextInput accessibilityLabel="Commit message" value={editedMessage} onChangeText={setEditedMessage} onFocus={() => setMessageFocused(true)} onBlur={() => setMessageFocused(false)} editable={!busy} maxLength={80} selectTextOnFocus style={[styles.messageInput, messageFocused && styles.messageInputFocused]} />
      {!validMessage ? <Text style={styles.error}>请输入不超过 80 个字符的提交标题。</Text> : null}
      <Text style={styles.files}>{files.length} 个文件 · 请展开查看具体 diff</Text>
      {diff === null && !error ? <Text style={styles.muted}>正在读取 diff…</Text> : null}
      {diff ? <View style={styles.diff}><FileTree files={parseDiffFiles(diff)} /></View> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error ? <TouchableOpacity accessibilityRole="button" onPress={() => { setError(""); setPreviewRequest((value) => value + 1); }} style={styles.retry}><Text style={styles.promptToggleText}>重新读取预览</Text></TouchableOpacity> : null}
    </>}
    {!done || promptToggle ? <View style={styles.actions}>
      {promptToggle}
      {!done ? <View style={styles.actionButtons}>
        <TouchableOpacity onPress={dismiss} disabled={busy} style={styles.cancel}><Text style={styles.cancelText}>取消</Text></TouchableOpacity>
        <TouchableOpacity onPress={submit} disabled={busy || !diff || Boolean(error) || !validMessage} style={[styles.confirm, (busy || !diff || error || !validMessage) ? styles.disabled : null]}><Text style={styles.confirmText}>{busy ? "处理中…" : "确认提交"}</Text></TouchableOpacity>
      </View> : null}
    </View> : null}
    {showPrompt && promptPreview ? <ScrollView style={styles.promptBox} nestedScrollEnabled><Text selectable style={styles.promptText}>{promptPreview}</Text></ScrollView> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { alignSelf: "stretch", backgroundColor: "#fff", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#d8dee6", padding: 14, gap: 10 },
  heading: { color: "#111827", fontSize: 15, fontWeight: "700" },
  label: { color: "#6b7280", fontSize: 11, fontWeight: "600" },
  messageInput: { color: "#1f2937", fontSize: 13, lineHeight: 19, borderWidth: 1, borderColor: "#d8dee6", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, outlineWidth: 0 },
  messageInputFocused: { borderColor: "#15803d" },
  files: { color: "#6b7280", fontSize: 12 },
  diff: { backgroundColor: "#f8fafc", borderRadius: 8, overflow: "hidden" },
  muted: { color: "#6b7280", fontSize: 12 },
  error: { color: "#b91c1c", fontSize: 12 },
  done: { color: "#166534", fontSize: 13 },
  doneMessage: { color: "#166534", fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  actionButtons: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" },
  cancel: { minHeight: 36, paddingHorizontal: 15, justifyContent: "center", borderRadius: 8, backgroundColor: "#f3f4f6" },
  cancelText: { color: "#374151", fontSize: 13, fontWeight: "600" },
  confirm: { minHeight: 36, paddingHorizontal: 15, justifyContent: "center", borderRadius: 8, backgroundColor: "#4f46e5" },
  confirmText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.55 },
  promptToggle: { minHeight: 36, justifyContent: "center" },
  promptToggleText: { color: "#4f46e5", fontSize: 12, fontWeight: "600" },
  promptBox: { maxHeight: 320, backgroundColor: "#f8fafc", borderRadius: 8, padding: 10 },
  promptText: { color: "#374151", fontFamily: "monospace", fontSize: 11, lineHeight: 17 },
  retry: { alignSelf: "flex-start", paddingVertical: 4 },
});
