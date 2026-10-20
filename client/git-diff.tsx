import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ContextMenu } from "./components/context-menu";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { gitCommitFileDiffRpc } from "../shared/git-history";
import { workspaceGitShelfDiffRpc, workspaceGitDiffRpc } from "../shared/workspace-commit";
import { parseDiffFiles } from "./diff/diff";
import { FileTypeIcon } from "./diff/file-icons";
import { SplitDiff } from "./diff/split-diff";
import { DiffOptionButton, WrapToggleButton } from "./diff/wrap-toggle";
import { useGitDiffState, type DiffTab } from "./git-diff-state";
const TAB_DRAG_TYPE = "application/x-vibe-review-diff-tab";
function ReorderableTab({ tab, active, onActivate, onClose, onReorder, onNode, theme, compact, onCloseOthers, onCloseAll }: {
  theme: PluginWorkspacePanelProps["theme"]; compact: boolean; onCloseOthers(): void; onCloseAll(): void;
  tab: DiffTab; active: boolean; onActivate: () => void; onClose: () => void;
  onReorder: (source: string, target: string, after: boolean) => void;
  onNode: (id: string, node: HTMLElement | null) => void;
}) {
  const ref = useRef<View>(null);
  const [hovered, setHovered] = useState(false);
  const [closeHovered, setCloseHovered] = useState(false);
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    onNode(tab.id, node);
    node.draggable = true;
    node.title = tab.path;
    const start = (event: DragEvent) => {
      event.dataTransfer?.setData(TAB_DRAG_TYPE, tab.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(TAB_DRAG_TYPE)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      const source = event.dataTransfer?.getData(TAB_DRAG_TYPE);
      if (!source) return;
      event.preventDefault();
      const bounds = node.getBoundingClientRect();
      reorderRef.current(source, tab.id, event.clientX > bounds.left + bounds.width / 2);
    };
    const enter = () => setHovered(true);
    const leave = () => { setHovered(false); setCloseHovered(false); };
    node.addEventListener("dragstart", start);
    node.addEventListener("dragover", over);
    node.addEventListener("drop", drop);
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", leave);
    return () => {
      node.draggable = false;
      node.removeAttribute("title");
      node.removeEventListener("dragstart", start);
      node.removeEventListener("dragover", over);
      node.removeEventListener("drop", drop);
      node.removeEventListener("mouseenter", enter);
      node.removeEventListener("mouseleave", leave);
      onNode(tab.id, null);
    };
  }, [tab.id, tab.path, onNode]);
  return <ContextMenu label={tab.path.split("/").at(-1) ?? tab.path} theme={theme} compact={compact} items={[
    { id: "copy-path", label: "复制文件路径", icon: "Copy", onSelect: () => copyText(tab.path) },
    { id: "tab-actions", separator: true },
    { id: "close", label: "关闭标签页", icon: "X", onSelect: onClose },
    { id: "close-others", label: "关闭其他标签页", onSelect: onCloseOthers },
    { id: "close-all", label: "关闭所有标签页", onSelect: onCloseAll },
  ]}><View ref={ref} style={[styles.tab, hovered && !active && styles.hoveredTab, active && styles.activeTab]}>
    <Pressable accessibilityRole="tab" accessibilityLabel={`${tab.source === "working" ? "工作区" : tab.source === "shelf" ? "Shelf" : "历史提交"} ${tab.path}`} accessibilityState={{ selected: active }} onPress={onActivate} style={styles.tabSelect}>
      <FileTypeIcon fileName={tab.path} />
      <Text style={[styles.tabTitle, fileColor(tab.status ?? "M")]} numberOfLines={1}>{tab.path.split("/").at(-1)}</Text>
      <Text style={styles.tabSource} numberOfLines={1}>{tab.source === "working" ? "工作区" : tab.source === "shelf" ? tab.label : tab.hash.slice(0, 7)}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`关闭 ${tab.path} 标签`} onPress={onClose} onHoverIn={() => setCloseHovered(true)} onHoverOut={() => setCloseHovered(false)} style={[styles.tabClose, closeHovered && styles.tabCloseHovered]}><Icon name="X" size={13} color="#94a3b8" /></Pressable>
  </View></ContextMenu>;
}

function fileColor(status: string) {
  if (status.includes("D") || status.includes("?")) return styles.deleted;
  if (status.includes("A")) return styles.added;
  return styles.modified;
}


export function GitDiffPanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const getFileDiff = useRpc(gitCommitFileDiffRpc);
  const getShelfDiff = useRpc(workspaceGitShelfDiffRpc);
  const getWorkingDiff = useRpc(workspaceGitDiffRpc);
  const { tabs, activeTabId, revision, setTabs, setActiveTabId, closeTab } = useGitDiffState(workspaceId);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [tabViewportWidth, setTabViewportWidth] = useState(0);
  const [tabContentWidth, setTabContentWidth] = useState(0);
  const tabBarRef = useRef<ScrollView>(null);
  const tabNodes = useRef(new Map<string, HTMLElement>());
  const [diff, setDiff] = useState<{ tabId: string | null; text: string; loading: boolean }>({ tabId: null, text: "", loading: false });
  const [diffHeight, setDiffHeight] = useState(0);
  const [wrapLines, setWrapLines] = useState(false);
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);
  const [syncScrolling, setSyncScrolling] = useState(true);
  const [error, setError] = useState("");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tabOverflow = tabContentWidth > tabViewportWidth + 2;

  const registerTabNode = useCallback((id: string, node: HTMLElement | null) => {
    if (node) tabNodes.current.set(id, node);
    else tabNodes.current.delete(id);
  }, []);
  const reorderTab = useCallback((source: string, target: string, after: boolean) => {
    if (source === target) return;
    setTabs((current) => {
      const moved = current.find((item) => item.id === source);
      if (!moved) return current;
      const next = current.filter((item) => item.id !== source);
      const targetIndex = next.findIndex((item) => item.id === target);
      if (targetIndex < 0) return current;
      next.splice(targetIndex + (after ? 1 : 0), 0, moved);
      return next;
    });
  }, [setTabs]);

  useEffect(() => {
    if (Platform.OS !== "web" || !activeTabId) return;
    const frame = requestAnimationFrame(() => {
      const scroller = tabBarRef.current as unknown as HTMLElement | null;
      const tabNode = tabNodes.current.get(activeTabId);
      if (!scroller || !tabNode) return;
      const viewport = scroller.getBoundingClientRect();
      const selected = tabNode.getBoundingClientRect();
      const offset = selected.left < viewport.left ? selected.left - viewport.left
        : selected.right > viewport.right ? selected.right - viewport.right : 0;
      if (offset) scroller.scrollLeft += offset;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTabId, tabs, tabViewportWidth]);

  useEffect(() => {
    let active = true;
    setError("");
    setDiff({ tabId: activeTab?.id ?? null, text: "", loading: Boolean(activeTab) });
    if (activeTab) {
      const request = activeTab.source === "working"
        ? getWorkingDiff({ workspaceId, path: activeTab.path, staged: activeTab.staged })
        : activeTab.source === "shelf" ? getShelfDiff({ workspaceId, entryId: activeTab.entryId, path: activeTab.path })
        : getFileDiff({ workspaceId, hash: activeTab.hash, path: activeTab.path });
      void request.then(
        (value) => { if (active) setDiff({ tabId: activeTab.id, text: value.diff, loading: false }); },
        (reason: unknown) => { if (active) { setDiff({ tabId: activeTab.id, text: "", loading: false }); setError(String(reason)); } },
      );
    }
    return () => { active = false; };
  }, [workspaceId, revision, activeTab?.id, activeTab?.source === "working" ? activeTab.staged : undefined]);

  const parsed = useMemo(() => parseDiffFiles(activeTab?.id === diff.tabId ? diff.text : ""), [activeTab?.id, diff.tabId, diff.text]);
  const loadFullDiff = async () => {
    if (!activeTab) return null;
    const result = activeTab.source === "working"
      ? await getWorkingDiff({ workspaceId, path: activeTab.path, staged: activeTab.staged, fullContext: true })
      : activeTab.source === "shelf" ? await getShelfDiff({ workspaceId, entryId: activeTab.entryId, path: activeTab.path })
      : await getFileDiff({ workspaceId, hash: activeTab.hash, path: activeTab.path, fullContext: true });
    return parseDiffFiles(result.diff)[0] ?? null;
  };
  const diffLoading = Boolean(activeTab && (activeTab.id !== diff.tabId || diff.loading));
  return <View style={styles.root}>
        <View style={styles.topDiff} onLayout={(event) => setDiffHeight(event.nativeEvent.layout.height)}>
          <View style={styles.tabStrip}>
            <ScrollView ref={tabBarRef} horizontal style={styles.tabBar} contentContainerStyle={styles.tabBarContent} showsHorizontalScrollIndicator={false} onLayout={(event) => setTabViewportWidth(event.nativeEvent.layout.width)} onContentSizeChange={(width) => setTabContentWidth(width)}>
              {tabs.length ? tabs.map((tab) => <ReorderableTab key={tab.id} theme={theme} compact={layout.compact} onCloseOthers={() => { setTabs((current) => current.filter((item) => item.id === tab.id)); setActiveTabId(tab.id); }} onCloseAll={() => { setTabs(() => []); setActiveTabId(null); }} tab={tab} active={activeTabId === tab.id} onActivate={() => setActiveTabId(tab.id)} onClose={() => closeTab(tab.id)} onReorder={reorderTab} onNode={registerTabNode} />) : <Text style={styles.emptyTab}>Diff 预览</Text>}
            </ScrollView>
            {tabOverflow && tabs.length ? <Pressable accessibilityRole="button" accessibilityLabel="显示所有打开的文件" accessibilityState={{ expanded: tabMenuOpen }} onPress={() => setTabMenuOpen((value) => !value)} style={[styles.tabMenuButton, tabMenuOpen && styles.tabMenuButtonActive]}><Icon name="ChevronDown" size={16} color="#64748b" /></Pressable> : null}
            {tabMenuOpen && tabOverflow ? <ScrollView style={[styles.tabMenu, { maxHeight: Math.min(360, Math.max(100, diffHeight - 45)) }]} nestedScrollEnabled>
              {tabs.map((tab) => <View key={tab.id} style={[styles.tabMenuRow, activeTabId === tab.id && styles.tabMenuRowActive]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`切换到 ${tab.path}`} onPress={() => { setActiveTabId(tab.id); setTabMenuOpen(false); }} style={styles.tabMenuSelect}>
                  <FileTypeIcon fileName={tab.path} />
                  <Text style={[styles.tabMenuTitle, fileColor(tab.status ?? "M")]} numberOfLines={1}>{tab.path.split("/").at(-1)}</Text>
                  <Text style={styles.tabSource}>{tab.source === "working" ? "工作区" : tab.source === "shelf" ? tab.label : tab.hash.slice(0, 7)}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`关闭 ${tab.path} 标签`} onPress={() => closeTab(tab.id)} style={styles.tabMenuClose}><Icon name="X" size={14} color="#94a3b8" /></Pressable>
              </View>)}
            </ScrollView> : null}
          </View>
          <View style={styles.diffHeader}>
            <Text style={styles.diffPath} numberOfLines={1}>{activeTab ? `${activeTab.source === "working" ? "Working Diff" : activeTab.source === "shelf" ? "Shelf Diff" : "Repository Diff"}: ${activeTab.path}` : "选择文件查看差异"}</Text>
            {activeTab ? <>
              <View style={styles.diffActions}><DiffOptionButton active={collapseUnchanged} onToggle={() => setCollapseUnchanged((value) => !value)} label="折叠未变更代码" icon="ChevronsDownUp" /><DiffOptionButton active={syncScrolling} onToggle={() => setSyncScrolling((value) => !value)} label="左右同步滚动" icon="ArrowDownUp" /><WrapToggleButton active={wrapLines} onToggle={() => setWrapLines((value) => !value)} /></View>
            </> : null}
          </View>
          {activeTab && parsed[0] && diffHeight > 75 ? <SplitDiff key={activeTab.id} file={parsed[0]} wrapLines={wrapLines} collapseUnchanged={collapseUnchanged} syncScrolling={syncScrolling} loadFullFile={loadFullDiff} maxHeight={Math.max(32, diffHeight - 75)} /> : <Text style={styles.empty}>{diffLoading ? "加载差异…" : activeTab ? "没有可显示的文本差异" : "在提交更改或 Git 历史面板中选择文件，在这里查看 Diff"}</Text>}
        </View>
{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: "#fff" },
  topDiff: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", backgroundColor: "#fff" },
  tabStrip: { flexDirection: "row", height: 36, minWidth: 0, position: "relative", zIndex: 10, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  tabBar: { flex: 1, minWidth: 0, height: 35 },
  tabBarContent: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
  tab: { flexDirection: "row", alignItems: "center", maxWidth: 220, height: 29, marginHorizontal: 3, borderWidth: 1, borderColor: "transparent", borderRadius: 7, paddingRight: 3 },
  hoveredTab: { backgroundColor: "#eeeeef" },
  activeTab: { backgroundColor: "#e4ecff", borderColor: "#9cbcff" },
  tabSelect: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1, paddingHorizontal: 8, height: 27 },
  tabTitle: { flexShrink: 1, fontSize: 12, color: "#475569" },
  tabSource: { flexShrink: 0, fontSize: 10, color: "#9ca3af" },
  tabClose: { width: 20, height: 20, flexShrink: 0, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tabCloseHovered: { backgroundColor: "#d7d9de" },
  tabMenuButton: { width: 34, height: 35, alignItems: "center", justifyContent: "center", borderLeftWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#fff" },
  tabMenuButtonActive: { backgroundColor: "#e8f0ff" },
  tabMenu: { position: "absolute", top: 35, right: 0, width: 300, backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 5, zIndex: 20, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
  tabMenuRow: { flexDirection: "row", alignItems: "center", minHeight: 32 },
  tabMenuRowActive: { backgroundColor: "#e8f0ff" },
  tabMenuSelect: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 10, minHeight: 32 },
  tabMenuTitle: { flex: 1, minWidth: 0, fontSize: 12, color: "#374151" },
  tabMenuClose: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  emptyTab: { paddingHorizontal: 10, paddingVertical: 9, color: "#6b7280", fontSize: 12 },
  added: { color: "#07833d" },
  modified: { color: "#1641ad" },
  deleted: { color: "#bc3145" },
  diffHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 38, paddingHorizontal: 9, position: "relative", zIndex: 20 },
  diffActions: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 0 },
  diffPath: { flex: 1, fontSize: 12, color: "#374151" },
  empty: { padding: 12, fontSize: 12, color: "#6b7280" },
  error: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 9, paddingVertical: 5, color: "#b91c1c", backgroundColor: "#fff", fontSize: 11 },
});
