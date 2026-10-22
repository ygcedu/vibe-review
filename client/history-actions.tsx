import { HistoryCompare } from "./history-compare";
import type { DiffTab } from "./git-diff-state";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { historyActionApplyRpc, historyActionPreviewRpc, type HistoryAction } from "../shared/history-actions";
import type { GitCommit } from "../shared/git-history";
import type { ContextMenuItem } from "./components/context-menu";

const actions: Record<HistoryAction, { title: string; icon: string; description: string; field?: "name" | "message"; destructive?: boolean }> = {
  "cherry-pick": { title: "拣选提交", icon: "GitCommitHorizontal", description: "将此提交的改动应用到当前 HEAD，创建一条新提交。如有冲突或提交为空，会自动中止并恢复。" },
  "checkout": { title: "检出此版本", icon: "GitCommitHorizontal", description: "以分离 HEAD 模式检出所选提交，不移动当前分支。工作区需无未提交改动。" },
  "new-tag": { title: "新建标签", icon: "Tag", description: "在所选提交上创建本地轻量标签，不自动推送。", field: "name" },
  "new-branch": { title: "新建分支", icon: "GitBranch", description: "在所选提交上创建分支，保持当前分支和工作区不变。", field: "name" },
};
function borderOnlyFocus(node: TextInput | null) {
  if (Platform.OS === "web" && node) (node as unknown as HTMLElement).style.setProperty("outline", "none", "important");
}
export function useHistoryActions({ workspaceId, theme, onChanged, onCompare }: Pick<PluginWorkspacePanelProps, "workspaceId" | "theme"> & { onChanged(): void; onCompare(tab: DiffTab): void }) {
  const prepare = useRpc(historyActionPreviewRpc);
  const apply = useRpc(historyActionApplyRpc);
  const toast = useToast();
  const colors = theme.colors;
  const [compareCommit, setCompareCommit] = useState<GitCommit | null>(null);
  const [target, setTarget] = useState<{ commit: GitCommit; action: HistoryAction } | null>(null);
  const [preview, setPreview] = useState<{ token: string; head: string; branch: string; message: string; parents: string[] } | null>(null);
  const [mainline, setMainline] = useState(1);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const request = useRef(0);
  useEffect(() => { request.current++; setTarget(null); setPreview(null); setCompareCommit(null); }, [workspaceId]);
  const open = async (commit: GitCommit, action: HistoryAction) => {
    const seq = ++request.current;
    setTarget({ commit, action }); setPreview(null); setMainline(1); setValue(""); setError(""); setLoading(true);
    try {
      const result = await prepare({ workspaceId, hash: commit.hash, action });
      if (request.current !== seq) return;
      setPreview(result);
      if (actions[action].field === "message") setValue(result.message);
    } catch (reason) { if (request.current === seq) setError(String(reason)); }
    finally { if (request.current === seq) setLoading(false); }
  };
  const close = () => { if (!busy) { request.current++; setTarget(null); setPreview(null); } };
  const execute = async () => {
    if (!target || !preview || busy) return;
    const seq = request.current;
    setBusy(true); setError("");
    try {
      const result = await apply({ workspaceId, token: preview.token, mainline, [actions[target.action].field ?? "name"]: value });
      if (seq !== request.current) return;
      setTarget(null); setPreview(null); onChanged(); toast.show(result.summary, { variant: "success" });
    } catch (reason) { if (seq === request.current) setError(String(reason)); }
    finally { setBusy(false); }
  };
  const config = target ? actions[target.action] : null;
  const button = (primary: boolean, pressed: boolean) => [styles.button, { backgroundColor: primary ? config?.destructive ? colors.statusDanger : colors.accent : pressed ? colors.surface2 : colors.surface1, borderColor: primary ? "transparent" : colors.border, opacity: pressed ? 0.8 : 1 }];
  const dialog = target && config ? <Modal title={config.title} open onOpenChange={(open) => { if (!open) close(); }}><Modal.Content contentContainerStyle={styles.content}>
    <Text style={[styles.description, { color: colors.foreground }]}>{config.description}</Text>
    <View style={[styles.target, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
      <Icon name="GitCommitHorizontal" size={14} color={colors.foregroundMuted} />
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={2} style={[styles.description, { color: colors.foreground }]}>{target.commit.subject}</Text><Text selectable style={[styles.caption, { color: colors.foregroundMuted }]}>{target.commit.hash.slice(0, 8)}{preview?.branch ? ` · 当前分支 ${preview.branch}` : ""}</Text></View>
    </View>
    {loading ? <ActivityIndicator color={colors.accent} /> : config.field && preview ? <>
      <Text style={[styles.caption, { color: colors.foregroundMuted }]}>{config.field === "name" ? "名称" : "提交说明"}</Text>
      <TextInput ref={borderOnlyFocus} autoFocus editable={!busy} accessibilityLabel={config.field === "name" ? "名称" : "提交说明"} value={value} onChangeText={setValue} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} multiline={config.field === "message"} placeholder={config.field === "name" ? "输入名称…" : "填写提交说明…"} placeholderTextColor={colors.foregroundMuted} style={[styles.input, { minHeight: config.field === "message" ? 100 : 36, color: colors.foreground, backgroundColor: colors.surface1, borderColor: focused ? colors.accent : colors.border }]} />
    </> : null}
    {target.action === "cherry-pick" && preview && preview.parents.length > 1 ? <View style={{ gap: 8 }}>
      <Text style={[styles.caption, { color: colors.foregroundMuted }]}>合并提交 · 选择主线父提交（应用相对此父提交的改动）</Text>
      {preview.parents.map((parent, index) => <Pressable key={parent} accessibilityRole="radio" accessibilityState={{ checked: mainline === index + 1 }} disabled={busy} onPress={() => setMainline(index + 1)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name={mainline === index + 1 ? "CircleDot" : "Circle"} size={14} color={colors.accent} /><Text style={[styles.caption, { color: colors.foreground }]}>父提交 {index + 1} · {parent.slice(0, 8)}</Text></Pressable>)}
    </View> : null}
    {error ? <Text accessibilityRole="alert" selectable style={[styles.caption, { color: colors.statusDanger }]}>{error}</Text> : null}
    <View style={styles.footer}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={({ pressed }) => button(false, pressed)}><Text style={[styles.label, { color: colors.foreground }]}>取消</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !preview || Boolean(config.field && !value.trim()), busy }} disabled={busy || !preview || Boolean(config.field && !value.trim())} onPress={() => void execute()} style={({ pressed }) => [button(true, pressed), (!preview || busy || Boolean(config.field && !value.trim())) && { opacity: 0.45 }]}>{busy ? <ActivityIndicator size="small" color={colors.accentForeground} /> : <Icon name={config.icon} size={14} color={colors.accentForeground} />}<Text style={[styles.label, { color: colors.accentForeground }]}>{busy ? "处理中…" : config.title}</Text></Pressable>
    </View>
  </Modal.Content></Modal> : null;
  function itemsFor(commit: GitCommit): ContextMenuItem[] {
    return [
      { id: "cherry-pick", label: "拣选提交（Cherry-Pick）…", icon: "GitCommitHorizontal", disabled: busy, onSelect: () => open(commit, "cherry-pick") },
      { id: "compare", label: "与本地比较…", icon: "FileDiff", onSelect: () => setCompareCommit(commit) },
      { id: "checkout", label: "检出此版本…", icon: "GitCommitHorizontal", disabled: busy, onSelect: () => open(commit, "checkout") },
      { id: "ref-separator", separator: true },
      { id: "new-tag", label: "新建标签…", icon: "Tag", disabled: busy, onSelect: () => open(commit, "new-tag") },
      { id: "new-branch", label: "新建分支…", icon: "GitBranch", disabled: busy, onSelect: () => open(commit, "new-branch") },
    ];
  }
  return { itemsFor, dialog: <>{dialog}{compareCommit ? <HistoryCompare key={compareCommit.hash} workspaceId={workspaceId} theme={theme} commit={compareCommit} onClose={() => setCompareCommit(null)} onFile={(file) => {
    onCompare({ id: `compare:${compareCommit.hash}:${file.path}`, source: "compare", hash: compareCommit.hash, path: file.path, status: file.status }); setCompareCommit(null);
  }} /> : null}</> };
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 }, description: { fontSize: 13, lineHeight: 21 }, caption: { fontSize: 12, lineHeight: 18 },
  target: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 8, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 6, padding: 8, outlineWidth: 0, fontSize: 13, lineHeight: 20, textAlignVertical: "top" },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 8 },
  button: { minHeight: 32, paddingHorizontal: 12, borderWidth: 1, borderRadius: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  label: { fontSize: 12, fontWeight: "500" },
});
