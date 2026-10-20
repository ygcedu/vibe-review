import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { usePaseo, useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { copyText, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { ContextMenu } from "./components/context-menu";
import { SessionProviderIcon } from "./components/session-provider-icon";
import { ToolbarButton } from "./components/toolbar-button";
import { sessionHistoryRpc, sessionRenameRpc, sessionDeleteRpc, sessionRestoreRpc, type SessionEntry } from "../shared/session-history";

function isDarkSurface(color: string) {
  const value = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  return parseInt(value.slice(0, 2), 16) * 0.2126 + parseInt(value.slice(2, 4), 16) * 0.7152 + parseInt(value.slice(4, 6), 16) * 0.0722 < 128;
}
function sessionDateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "更早";
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "今天";
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return date.toLocaleDateString(undefined, { year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined, month: "long", day: "numeric" });
}
function sessionTime(value: string) {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
export function SessionHistoryPanel({ workspaceId, theme, layout, navigation, host }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const [providerIcons, setProviderIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let disposed = false;
    void paseo.providers.snapshot().then(({ entries }) => { if (!disposed) setProviderIcons(Object.fromEntries(entries.filter((entry) => entry.iconSvg).map((entry) => [entry.provider, entry.iconSvg!]))); }).catch(() => {});
    return () => { disposed = true; };
  }, [paseo]);
  const list = useRpc(sessionHistoryRpc);
  const rename = useRpc(sessionRenameRpc);
  const restore = useRpc(sessionRestoreRpc);
  const opening = useRef(false);
  const remove = useRpc(sessionDeleteRpc);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ action: "rename" | "delete"; session: SessionEntry } | null>(null);
  const [title, setTitle] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const generation = useRef(0);
  const scope = useRef(workspaceId);
  scope.current = workspaceId;
  const colors = theme.colors;
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    setSessions([]); setSelectedId(null); setDialog(null); setError(""); setBusy(false);
  }, [workspaceId]);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    void list({ workspaceId }).then((value) => { if (generation.current === request) { setSessions(value.sessions); setError(""); } }, (reason) => { if (generation.current === request) setError(String(reason)); }).finally(() => { if (generation.current === request) setLoading(false); });
    return () => { generation.current++; };
  }, [workspaceId, revision]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = paseo.agents.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    });
    const poll = setInterval(refresh, 30_000);
    return () => { release(); if (timer) clearTimeout(timer); clearInterval(poll); };
  }, [paseo, workspaceId]);
  const open = async (session: SessionEntry) => {
    if (!navigation) { setError("当前客户端不支持会话导航，请升级 Paseo 客户端"); return; }
    if (opening.current) return;
    const requestWorkspace = workspaceId;
    opening.current = true;
    setBusy(true); setError("");
    try {
      await restore({ workspaceId, agentId: session.id });
      if (scope.current !== requestWorkspace) return;
      // The restore RPC uses a separate daemon connection. Hydrate the app's
      // own agent cache before navigation reads workspace/archive state.
      const result = await paseo.agents.ref(session.id).refresh();
      if (scope.current !== requestWorkspace) return;
      if (!result?.agent || result.agent.workspaceId !== requestWorkspace) throw new Error("会话已删除或已移出当前 workspace，请刷新列表");
      if (result.agent.archivedAt) throw new Error("会话仍处于归档状态，请重试");
      refresh();
      navigation.openAgent({ agentId: session.id, serverId: host.id });
      setSelectedId(session.id);
    } catch (reason) { if (scope.current === requestWorkspace) setError(String(reason)); }
    finally { opening.current = false; if (scope.current === requestWorkspace) setBusy(false); }
  };
  const edit = (session: SessionEntry) => { setTitle(session.title ?? ""); setError(""); setDialog({ action: "rename", session }); };
  const submit = async () => {
    if (!dialog || busy) return;
    const requestWorkspace = workspaceId;
    setBusy(true); setError("");
    try {
      if (dialog.action === "rename") await rename({ workspaceId, agentId: dialog.session.id, title: title.trim() });
      else await remove({ workspaceId, agentId: dialog.session.id, confirmed: true });
      if (scope.current === requestWorkspace) { setDialog(null); refresh(); }
    } catch (reason) { if (scope.current === requestWorkspace) setError(String(reason)); }
    finally { if (scope.current === requestWorkspace) setBusy(false); }
  };
  return <View style={[styles.root, { backgroundColor: colors.surface0 }]}>
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.toolbar, { borderColor: colors.border }]}>
      <ToolbarButton label="刷新会话历史" icon="RefreshCw" onPress={refresh} disabled={loading} theme={theme} boundary={{ width }} />
      <Text style={[styles.count, { color: colors.foregroundMuted }]}>{loading ? "正在同步…" : `${sessions.length} 个会话`}</Text>
    </View>
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {sessions.map((session, index) => <View key={session.id}>
        {index === 0 || sessionDateLabel(session.lastActivityAt || session.updatedAt) !== sessionDateLabel(sessions[index - 1].lastActivityAt || sessions[index - 1].updatedAt) ? <Text style={[styles.dateHeading, { color: colors.foregroundMuted }]}>{sessionDateLabel(session.lastActivityAt || session.updatedAt)}</Text> : null}
        <ContextMenu style={[styles.session, { borderColor: selectedId === session.id ? colors.accent : colors.border, backgroundColor: selectedId === session.id ? colors.surface2 : hovered === session.id ? colors.surface1 : "transparent" }]} theme={theme} compact={layout.compact} moreStyle={styles.more} showMore label={session.title || "未命名会话"} disabled={busy} items={[
        { id: "open", label: "打开会话", icon: "MessageSquare", disabled: !navigation, onSelect: () => open(session) },
        { id: "rename", label: "重命名…", icon: "Pencil", onSelect: () => edit(session) },
        { id: "copy", label: "复制 Agent ID", icon: "Copy", onSelect: () => copyText(session.id) },
        { id: "separator", separator: true },
        { id: "delete", label: "永久删除…", icon: "Trash2", destructive: true, onSelect: () => { setError(""); setDialog({ action: "delete", session }); } },
      ]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`打开会话 ${session.title || "未命名会话"}`} accessibilityState={{ selected: selectedId === session.id }} disabled={busy} onHoverIn={() => setHovered(session.id)} onHoverOut={() => setHovered(null)} onPress={() => open(session)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface2 : "transparent" }]}>
          <SessionProviderIcon agentId={session.id} session={session} dark={isDarkSurface(colors.surface0)} backdrop={selectedId === session.id ? colors.surface2 : hovered === session.id ? colors.surface1 : colors.surface0} provider={session.provider} svg={providerIcons[session.provider]} color={selectedId === session.id ? colors.accent : colors.foreground} />
          <Text style={[styles.title, { color: selectedId === session.id ? colors.accent : colors.foreground }]} numberOfLines={1}>{session.title || "未命名会话"}</Text>
          <Text accessibilityLabel={`最近活动于 ${new Date(session.lastActivityAt || session.updatedAt).toLocaleString()}`} style={[styles.time, { color: colors.foregroundMuted }]}>{sessionTime(session.lastActivityAt || session.updatedAt)}</Text>
        </Pressable>
      </ContextMenu></View>)}
      {loading && !sessions.length ? <Text style={[styles.empty, { color: colors.foregroundMuted }]}>加载会话历史…</Text> : !loading && !sessions.length && !error ? <Text style={[styles.empty, { color: colors.foregroundMuted }]}>当前 workspace 暂无会话</Text> : null}
    </ScrollView>
    {error && !dialog ? <Text style={[styles.empty, { color: colors.statusDanger }]}>{error}</Text> : null}
    {dialog ? <Modal title={dialog.action === "rename" ? "重命名会话" : "永久删除会话"} open onOpenChange={(value) => { if (!value && !busy) { setDialog(null); setError(""); } }}><Modal.Content>
      {dialog.action === "rename" ? <TextInput accessibilityLabel="会话名称" value={title} onChangeText={setTitle} editable={!busy} maxLength={200} autoFocus placeholder="输入会话名称" placeholderTextColor={colors.foregroundMuted} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} /> : <>
        <Text style={{ color: colors.foreground }}>永久删除“{dialog.session.title || "未命名会话"}”？删除后无法恢复会话记录。</Text>
        <Text selectable style={{ color: colors.foregroundMuted }}>Agent ID：{dialog.session.id}</Text>
        {dialog.session.status === "running" || dialog.session.status === "initializing" ? <Text style={{ color: colors.statusWarning }}>此会话正在运行，删除会中断任务。</Text> : null}
      </>}
      {error ? <Text style={{ color: colors.statusDanger }}>{error}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="取消会话操作" disabled={busy} onPress={() => { setDialog(null); setError(""); }} style={styles.action}><Text style={{ color: colors.foregroundMuted }}>取消</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={dialog.action === "rename" ? "保存会话名称" : "确认永久删除会话"} disabled={busy || (dialog.action === "rename" && !title.trim())} onPress={() => void submit()} style={styles.action}><Text style={{ color: dialog.action === "delete" ? colors.statusDanger : colors.accent }}>{busy ? "处理中…" : dialog.action === "rename" ? "保存" : "永久删除"}</Text></Pressable>
      </View>
    </Modal.Content></Modal> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0 },
  toolbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: 1, zIndex: 20 },
  count: { marginLeft: "auto", marginRight: 8, fontSize: 11 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 10, paddingBottom: 12 },
  dateHeading: { fontSize: 11, fontWeight: "500", paddingHorizontal: 2, paddingTop: 14, paddingBottom: 8 },
  session: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, marginBottom: 6, overflow: "hidden" },
  row: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingLeft: 10, paddingRight: 2 },
  more: { marginRight: 2 },
  title: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19, fontWeight: "400" },
  time: { fontSize: 10, lineHeight: 16, fontVariant: ["tabular-nums"] },
  empty: { padding: 12, fontSize: 12 },
  input: { padding: 10, borderWidth: 1, borderRadius: 6, fontSize: 14 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  action: { padding: 10 },
});
