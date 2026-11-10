import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { branchActionRpc, type BranchAction } from "../shared/branch-actions";
import type { ContextMenuItem } from "./components/context-menu";
const titles: Record<BranchAction, string> = { checkout: "检出", new: "从此处新建分支…", "checkout-rebase": "检出此分支并变基到当前分支…", compare: "与当前分支比较…", "working-diff": "与工作区比较…", rebase: "将当前分支变基到此分支…", merge: "合并到当前分支…", update: "更新（仅快进）…", push: "推送…", rename: "重命名…", delete: "删除分支…", fetch: "获取所有远程更新…" };
const descriptions: Partial<Record<BranchAction, string>> = { rebase: "重写当前分支历史；自动创建恢复分支，冲突时中止。", merge: "将所选分支合并到当前分支；冲突时中止。", "checkout-rebase": "检出所选分支，再将它变基到当前分支；冲突时中止并返回原分支。", update: "获取远程更新，仅在可以快进时更新所选分支。", push: "将所选分支推送到它配置的远程跟踪分支，不使用强制推送。", delete: "仅删除已合并的本地分支，不删除远端分支。", new: "从所选版本创建本地分支，保持当前检出不变。" };
export function useBranchActions({ workspaceId, theme, currentBranch, onChanged }: Pick<PluginWorkspacePanelProps, "workspaceId" | "theme"> & { currentBranch: string; onChanged(): void }) {
  const rpc = useRpc(branchActionRpc), toast = useToast(), colors = theme.colors;
  const [target, setTarget] = useState<{ ref: string; action: BranchAction } | null>(null);
  const [preview, setPreview] = useState<{ head: string; target: string; current: string } | null>(null);
  const [name, setName] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [diff, setDiff] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => { seq.current++; setTarget(null); setBusy(false); }, [workspaceId]);
  const open = async (ref: string, action: BranchAction) => {
    const id = ++seq.current; setTarget({ ref, action }); setPreview(null); setDiff(null); setName(action === "rename" ? ref.replace("refs/heads/", "") : ""); setError(""); setBusy(true);
    try { const value = await rpc({ workspaceId, ref, action, preview: true }); if (id === seq.current) setPreview(value); }
    catch (reason) { if (id === seq.current) setError(String(reason)); }
    finally { if (id === seq.current) setBusy(false); }
  };
  const execute = async () => {
    if (!target || !preview || busy) return;
    const id = seq.current; setBusy(true); setError("");
    try {
      const result = await rpc({ workspaceId, ...target, name, expectedHead: preview.head, expectedTarget: preview.target });
      if (id !== seq.current) return;
      if (result.diff !== undefined) setDiff(result.diff || "没有差异");
      else { setTarget(null); onChanged(); toast.show(result.summary, { variant: "success" }); }
    } catch (reason) { if (id === seq.current) setError(String(reason)); }
    finally { if (id === seq.current) setBusy(false); }
  };
  const itemsFor = (ref: string): ContextMenuItem[] => {
    const local = ref.startsWith("refs/heads/"), tag = ref.startsWith("refs/tags/"), current = ref === `refs/heads/${currentBranch}`;
    const item = (action: BranchAction, icon: string): ContextMenuItem => ({ id: action, label: titles[action], icon, disabled: busy, destructive: action === "delete", onSelect: () => open(ref, action) });
    return [ ...(!current ? [item("checkout", "GitBranch")] : []), item("new", "Plus"), ...(!current && local && currentBranch ? [item("checkout-rebase", "GitBranch")] : []), { id: "compare-separator", separator: true }, ...(!current && currentBranch ? [item("compare", "GitCompareArrows")] : []), item("working-diff", "FileDiff"), ...(!tag && !current && currentBranch ? [{ id: "integrate-separator", separator: true } as ContextMenuItem, item("rebase", "GitBranch"), item("merge", "GitMerge")] : []), ...(local ? [{ id: "remote-separator", separator: true } as ContextMenuItem, item("update", "ArrowDown"), item("push", "ArrowUp"), { id: "manage-separator", separator: true } as ContextMenuItem, item("rename", "Pencil"), ...(!current ? [item("delete", "Trash2")] : [])] : []) ];
  };
  const close = () => { if (!busy) { seq.current++; setTarget(null); } };
  return { open, itemsFor, busy, dialog: target ? <Modal title={titles[target.action]} open onOpenChange={(value) => { if (!value) close(); }}><Modal.Content contentContainerStyle={{ padding: 20, gap: 12 }}>
    <Text selectable style={{ fontSize: 13, color: colors.foreground }}>{target.ref.replace(/^refs\/(heads|remotes|tags)\//, "")} → 当前分支 {preview?.current || currentBranch || "HEAD"}</Text>
    {descriptions[target.action] ? <Text style={{ fontSize: 12, lineHeight: 20, color: colors.foregroundMuted }}>{descriptions[target.action]}</Text> : null}
    {target.action === "new" || target.action === "rename" ? <TextInput ref={(node) => { if (node && Platform.OS === "web") (node as unknown as HTMLElement).style.setProperty("outline", "none", "important"); }} autoFocus editable={!busy} accessibilityLabel="分支名称" value={name} onChangeText={setName} placeholder="分支名称" placeholderTextColor={colors.foregroundMuted} style={{ padding: 10, borderWidth: 1, borderRadius: 6, borderColor: colors.accent, color: colors.foreground, fontSize: 13 }} /> : null}
    {busy ? <ActivityIndicator color={colors.accent} /> : null}
    {error ? <Text selectable accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
    {diff !== null ? <ScrollView style={{ maxHeight: 420 }} horizontal><ScrollView><Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 19 }}>{diff}</Text></ScrollView></ScrollView> : null}
    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}><Pressable disabled={busy} onPress={close} style={{ padding: 10 }}><Text style={{ color: colors.foreground }}>关闭</Text></Pressable>{diff === null ? <Pressable disabled={busy || !preview || ((target.action === "new" || target.action === "rename") && !name.trim())} onPress={() => void execute()} style={{ padding: 10, borderRadius: 6, backgroundColor: colors.accent, opacity: busy || !preview ? 0.4 : 1 }}><Text style={{ color: colors.accentForeground }}>确认{titles[target.action].replace("…", "")}</Text></Pressable> : null}</View>
  </Modal.Content></Modal> : null };
}
