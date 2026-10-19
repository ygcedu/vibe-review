import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { workspaceGitShelfRpc, type ShelfEntry, workspaceGitCommitRpc, workspaceGitPushRpc, workspaceGitTrackRpc, workspaceGitStatusRpc, type WorkingFile as File } from "../shared/workspace-commit";
import { useGitDiffState } from "./git-diff-state";
import { FileTypeIcon } from "./diff/file-icons";
import { buildFileTree, type FileTreeNode } from "./diff/file-tree-utils";

type Selection = { path: string; staged: boolean; status?: string };
type TreeNode = FileTreeNode<File>;
const checkboxState = (files: File[], selected: Set<string>) => files.length > 0 && files.every((file) => selected.has(file.path)) ? "all" : files.some((file) => selected.has(file.path)) ? "partial" : "none";
const checkboxIcon = (state: "all" | "partial" | "none") => state === "all" ? "SquareCheck" : state === "partial" ? "SquareMinus" : "Square";
const dragType = "application/x-vibe-review-git-files";
function fileNameColor(file: File) {
  if (file.untracked || file.status.includes("D")) return styles.removedName;
  if (file.status.includes("A") || file.status.includes("?")) return styles.addedName;
  return styles.path;
}
function changeKind(file: File): "added" | "modified" | "deleted" {
  if (file.status.includes("D")) return "deleted";
  if (file.untracked || file.status.includes("A")) return "added";
  return "modified";
}

function DraggableRow({ children, paths, workspaceId, style }: { children: ReactNode; paths: string[]; workspaceId: string; style: ViewStyle | Array<ViewStyle | false | undefined> }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    node.draggable = true;
    const start = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(dragType, JSON.stringify({ workspaceId, paths }));
    };
    node.addEventListener("dragstart", start);
    return () => { node.removeEventListener("dragstart", start); node.draggable = false; };
  }, [workspaceId, paths.join("\0")]);
  return <View ref={ref} style={style}>{children}</View>;
}

function TrackedDropZone({ children, workspaceId, onFiles }: { children: ReactNode; workspaceId: string; onFiles(paths: string[]): void }) {
  const ref = useRef<View>(null);
  const [hovered, setHovered] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(dragType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setHovered(true);
    };
    const leave = (event: DragEvent) => { if (!node.contains(event.relatedTarget as Node | null)) setHovered(false); };
    const drop = (event: DragEvent) => {
      setHovered(false);
      const data = event.dataTransfer?.getData(dragType);
      if (!data) return;
      event.preventDefault();
      try {
        const value: unknown = JSON.parse(data);
        if (typeof value !== "object" || value === null || !("workspaceId" in value) || value.workspaceId !== workspaceId || !("paths" in value) || !Array.isArray(value.paths) || !value.paths.every((path) => typeof path === "string")) return;
        onFilesRef.current(value.paths);
      } catch { /* Ignore unrelated browser drag payloads. */ }
    };
    node.addEventListener("dragover", over);
    node.addEventListener("dragleave", leave);
    node.addEventListener("drop", drop);
    return () => { node.removeEventListener("dragover", over); node.removeEventListener("dragleave", leave); node.removeEventListener("drop", drop); };
  }, [workspaceId]);
  return <View ref={ref} style={hovered && styles.dropTarget}>{children}</View>;
}

export function WorkspaceCommitPanel({ workspaceId, onFilePreview, externalPreview, onOpenShelfDiff }: PluginWorkspacePanelProps & { onFilePreview: (selection: Selection) => void; externalPreview?: Selection | null; onOpenShelfDiff: () => void }) {
  const [tab, setTab] = useState<"commit" | "shelf">("commit");
  const getStatus = useRpc(workspaceGitStatusRpc);
  const trackFiles = useRpc(workspaceGitTrackRpc);
  const commit = useRpc(workspaceGitCommitRpc);
  const push = useRpc(workspaceGitPushRpc);
  const [files, setFiles] = useState<File[]>([]);
  const [branch, setBranch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [revision, setRevision] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void getStatus({ workspaceId }).then((value) => {
      if (active) {
        setFiles(value.files);
        setSelectedPaths((current) => new Set([...current].filter((path) => value.files.some((file) => file.path === path))));
        setBranch(value.branch);
        setError("");
      }
    }, (reason: unknown) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [workspaceId, revision]);

  const toggleSelection = (targetFiles: File[]) => setSelectedPaths((current) => {
    const next = new Set(current);
    const select = checkboxState(targetFiles, current) !== "all";
    for (const file of targetFiles) {
      if (select) next.add(file.path);
      else next.delete(file.path);
    }
    return next;
  });
  const track = async (paths: string[]) => {
    if (!paths.length || busy) return;
    setBusy(true);
    try {
      await trackFiles({ workspaceId, paths });
      setRevision((value) => value + 1);
      setError("");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (busy) return;
    if (selectedPaths.size === 0) { setError("请先勾选要提交的文件"); return; }
    if (!message.trim()) { setError("请填写提交说明"); return; }
    setBusy(true);
    try {
      const value = await commit({ workspaceId, message: message.trim(), paths: [...selectedPaths] });
      setResult(value.summary);
      setMessage("");
      setSelectedPaths(new Set());
      setRevision((current) => current + 1);
      setError("");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const pushBranch = async () => {
    if (busy) return;
    setBusy(true);
    setPushing(true);
    try {
      const value = await push({ workspaceId });
      setResult(value.summary);
      setError("");
    } catch (reason) { setError(String(reason)); }
    finally { setPushing(false); setBusy(false); }
  };

  const groups: Array<{ title: string; files: File[] }> = [
    { title: "已跟踪", files: files.filter((file) => !file.untracked) },
    ...(files.some((file) => file.untracked) ? [{ title: "未跟踪", files: files.filter((file) => file.untracked) }] : []),
  ];
  const selectedFiles = files.filter((file) => selectedPaths.has(file.path));
  const counts = selectedFiles.reduce((result, file) => {
    result[changeKind(file)]++;
    return result;
  }, { added: 0, modified: 0, deleted: 0 });
  const toggleFolder = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleGroup = (title: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    return next;
  });
  const renderNodes = (nodes: TreeNode[], group: { title: string }, depth: number): React.ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") {
      const key = `${group.title}:${node.path}`;
      const isCollapsed = collapsed.has(key);
      const row = <>
        <Pressable accessibilityRole="button" accessibilityLabel={`${isCollapsed ? "展开" : "折叠"} ${node.path}`} accessibilityState={{ expanded: !isCollapsed }} onPress={() => toggleFolder(key)} style={styles.chevron}>
          <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} size={15} color="#64748b" />
        </Pressable>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: checkboxState(node.files, selectedPaths) === "all" }} accessibilityLabel={`${checkboxState(node.files, selectedPaths) === "all" ? "取消选择" : "选择"} ${node.path} 下的文件`} onPress={() => toggleSelection(node.files)} style={styles.checkbox}>
          <Icon name={checkboxIcon(checkboxState(node.files, selectedPaths))} size={17} color="#64748b" />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => toggleFolder(key)} style={styles.fileButton}>
          <Icon name="Folder" size={16} color="#6b7280" />
          <Text style={[styles.folderName, group.title === "未跟踪" && styles.untrackedName]} numberOfLines={1}>{node.name}</Text>
          <Text style={styles.count} numberOfLines={1}>{node.files.length} 个文件</Text>
        </Pressable>
      </>;
      const rowStyle = [styles.fileRow, { paddingLeft: 29 + depth * 20 }];
      return <View key={key}>
        {group.title === "未跟踪" ? <DraggableRow workspaceId={workspaceId} paths={node.files.map((file) => file.path)} style={rowStyle}>{row}</DraggableRow> : <View style={rowStyle}>{row}</View>}
        {!isCollapsed ? renderNodes(node.children, group, depth + 1) : null}
      </View>;
    }
    const file = node.file;
    const row = <>
      <View style={styles.chevron} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedPaths.has(file.path) }} accessibilityLabel={`${selectedPaths.has(file.path) ? "取消选择" : "选择"} ${file.path} 用于提交`} onPress={() => toggleSelection([file])} style={styles.checkbox}>
        <Icon name={checkboxIcon(checkboxState([file], selectedPaths))} size={17} color="#64748b" />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${file.path} 的差异`} onPress={() => {
        const selection = { path: file.path, staged: !file.unstaged && file.staged, status: file.untracked ? "??" : file.status };
        onFilePreview(selection);
      }} style={styles.fileButton}>
        <FileTypeIcon fileName={node.name} />
        <Text style={[styles.path, fileNameColor(file)]} numberOfLines={1}>{node.name}</Text>
      </Pressable>
    </>;
    const rowStyle = [styles.fileRow, { paddingLeft: 29 + depth * 20 }, externalPreview?.path === file.path && styles.active];
    return group.title === "未跟踪"
      ? <DraggableRow key={`${group.title}:${file.path}`} workspaceId={workspaceId} paths={[file.path]} style={rowStyle}>{row}</DraggableRow>
      : <View key={`${group.title}:${file.path}`} style={rowStyle}>{row}</View>;
  });

  return <View style={styles.root}>
    <View style={styles.tabs} accessibilityRole="tablist">
      {(["commit", "shelf"] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.selectedTab]}>
        <Text style={[styles.tabText, tab === value && styles.selectedTabText]}>{value === "commit" ? "Commit" : "Shelf"}</Text>
      </Pressable>)}
    </View>
    {tab === "shelf" ? <Shelf workspaceId={workspaceId} onOpenDiff={onOpenShelfDiff} /> : <>
    <View style={styles.toolbar}>
      <Text style={styles.heading}>提交更改{branch ? ` · ${branch}` : ""}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="刷新 Git 状态" onPress={() => setRevision((value) => value + 1)}><Icon name="RefreshCw" size={17} color="#64748b" /></Pressable>
    </View>
    <ScrollView style={styles.listExpanded}>
      {groups.map((group) => {
        const isCollapsed = collapsedGroups.has(group.title);
        const header = <>
          <Pressable accessibilityRole="button" accessibilityLabel={`${isCollapsed ? "展开" : "折叠"}${group.title}`} accessibilityState={{ expanded: !isCollapsed }} onPress={() => toggleGroup(group.title)} style={styles.chevron}>
            <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} size={15} color="#64748b" />
          </Pressable>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: checkboxState(group.files, selectedPaths) === "all" }} accessibilityLabel={`${checkboxState(group.files, selectedPaths) === "all" ? "取消选择" : "选择"}全部${group.title}文件用于提交`} onPress={() => toggleSelection(group.files)} disabled={group.files.length === 0} style={styles.checkbox}>
            <Icon name={checkboxIcon(checkboxState(group.files, selectedPaths))} size={17} color="#64748b" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${isCollapsed ? "展开" : "折叠"}${group.title}`} onPress={() => toggleGroup(group.title)} style={styles.groupButton}>
            <Text style={styles.group}>{group.title}  {group.files.length} 个文件</Text>
          </Pressable>
        </>;
        const content = <View>
          {group.title === "未跟踪" && group.files.length > 0
            ? <DraggableRow workspaceId={workspaceId} paths={group.files.map((file) => file.path)} style={styles.groupRow}>{header}</DraggableRow>
            : <View style={styles.groupRow}>{header}</View>}
          {!isCollapsed ? renderNodes(buildFileTree(group.files, true), group, 0) : null}
        </View>;
        return group.title === "已跟踪"
          ? <TrackedDropZone key={group.title} workspaceId={workspaceId} onFiles={(paths) => void track(files.filter((file) => file.untracked && paths.includes(file.path)).map((file) => file.path))}>{content}</TrackedDropZone>
          : <View key={group.title}>{content}</View>;
      })}
      {files.length === 0 && !error ? <Text style={styles.empty}>工作区没有待提交的改动</Text> : null}
    </ScrollView>
    <View style={styles.footer}>
      {selectedFiles.length > 0 ? <View style={styles.summaryRow}>
        <Text style={styles.summaryCount}>已选 {selectedFiles.length} 个文件</Text>
        <View style={styles.summaryDetails}>
          {counts.added > 0 ? <Text style={styles.addedName}>新增 {counts.added}</Text> : null}
          {counts.modified > 0 ? <Text style={styles.summaryModified}>修改 {counts.modified}</Text> : null}
          {counts.deleted > 0 ? <Text style={styles.removedName}>删除 {counts.deleted}</Text> : null}
        </View>
      </View> : null}
      <TextInput value={message} onChangeText={setMessage} multiline accessibilityLabel="提交说明" placeholder="填写提交说明…" placeholderTextColor="#94a3b8" style={styles.message} />
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="推送当前分支" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void pushBranch()} style={[styles.push, busy && styles.disabled]}><Text style={styles.pushText}>{pushing ? "推送中…" : "推送"}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="提交勾选的文件" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void submit()} style={[styles.commit, busy && styles.disabled]}><Text style={styles.commitText}>{busy && !pushing ? "提交中…" : "提交"}</Text></Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {result ? <Text style={styles.result}>{result}</Text> : null}
    </View>
    </>}
  </View>;
}

function Shelf({ workspaceId, onOpenDiff }: { workspaceId: string; onOpenDiff: () => void }) {
  const { openTab, tabs, activeTabId } = useGitDiffState(workspaceId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const renderTree = (entry: ShelfEntry, nodes: FileTreeNode<{ path: string }>[], depth = 0): ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") {
      const key = `${entry.id}:${node.path}`;
      const closed = collapsed.has(key);
      return <View key={key}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${closed ? "展开" : "折叠"} ${node.path}`} accessibilityState={{ expanded: !closed }} onPress={() => setCollapsed((current) => {
          const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
        })} style={[styles.fileRow, { paddingLeft: 29 + depth * 20 }]}>
          <View style={styles.chevron}><Icon name={closed ? "ChevronRight" : "ChevronDown"} size={15} color="#64748b" /></View>
          <View style={styles.fileButton}><Icon name="Folder" size={16} color="#6b7280" /><Text style={styles.folderName} numberOfLines={1}>{node.name}</Text><Text style={styles.count}>{node.files.length} 个文件</Text></View>
        </Pressable>
        {!closed ? renderTree(entry, node.children, depth + 1) : null}
      </View>;
    }
    const path = node.file.path;
    return <View key={path} style={[styles.fileRow, { paddingLeft: 29 + depth * 20 }, activeTab?.source === "shelf" && activeTab.entryId === entry.id && activeTab.path === path && styles.active]}>
      <View style={styles.chevron} />
      <Pressable accessibilityRole="button" accessibilityLabel={`查看暂存 ${path} 的差异`} style={styles.fileButton} onPress={() => {
        openTab({ id: `shelf:${entry.id}:${path}`, source: "shelf", entryId: entry.id, label: entry.message, path });
        onOpenDiff();
      }}><FileTypeIcon fileName={node.name} /><Text style={styles.path} numberOfLines={1}>{node.name}</Text></Pressable>
    </View>;
  });
  const getShelf = useRpc(workspaceGitShelfRpc);
  const [entries, setEntries] = useState<ShelfEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getShelf({ workspaceId }).then((value) => {
      if (active) setEntries(value.entries);
    }, (reason: unknown) => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, revision]);
  return <>
    <View style={styles.toolbar}>
      <Text style={styles.heading}>暂存的更改</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="刷新 Shelf" onPress={() => setRevision((value) => value + 1)}><Icon name="RefreshCw" size={17} color="#64748b" /></Pressable>
    </View>
    <ScrollView style={styles.listExpanded}>
      {loading ? <Text style={styles.empty}>加载暂存内容…</Text> : error ? <Text style={[styles.empty, styles.error]}>{error}</Text> : entries.length === 0 ? <Text style={styles.empty}>没有暂存的更改（Shelf / Git stash）</Text> : entries.map((entry) => <View key={entry.id} style={styles.shelfEntry}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${expanded.has(entry.id) ? "折叠" : "展开"} ${entry.message}`} accessibilityState={{ expanded: expanded.has(entry.id) }} style={styles.shelfRow} onPress={() => setExpanded((current) => {
          const next = new Set(current);
          if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
          return next;
        })}>
          <Icon name={expanded.has(entry.id) ? "ChevronDown" : "ChevronRight"} size={15} color="#64748b" />
          <View style={styles.shelfInfo}>
            <Text style={styles.shelfMessage} numberOfLines={2}>{entry.message}</Text>
            <Text style={styles.shelfMeta}>{entry.ref} · {entry.files.length} 个文件 · {entry.date ? new Date(entry.date).toLocaleString() : "时间未知"}</Text>
          </View>
        </Pressable>
        {expanded.has(entry.id) ? renderTree(entry, buildFileTree(entry.files.map((path) => ({ path })), true)) : null}
      </View>)}
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", backgroundColor: "#fff" },
  tabs: { flexDirection: "row", gap: 4, padding: 8, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6 },
  selectedTab: { backgroundColor: "#e9f0ff" },
  tabText: { fontSize: 14, color: "#64748b" },
  selectedTabText: { color: "#1641ad", fontWeight: "600" },
  shelfEntry: { borderBottomWidth: 1, borderColor: "#f1f5f9" },
  shelfRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  shelfInfo: { flex: 1, minWidth: 0, gap: 4 },
  shelfMessage: { fontSize: 13, color: "#111827" },
  shelfMeta: { fontSize: 11, color: "#64748b" },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  heading: { fontSize: 15, fontWeight: "600", color: "#111827" },
  listExpanded: { flex: 1, minHeight: 0 },
  groupRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 9, paddingTop: 10, paddingBottom: 4 },
  group: { fontSize: 12, fontWeight: "600", color: "#6b7280" },
  groupButton: { flex: 1, minHeight: 27, justifyContent: "center" },
  fileRow: { flexDirection: "row", alignItems: "center", minHeight: 32, paddingHorizontal: 9 },
  active: { backgroundColor: "#e9f0ff" },
  checkbox: { padding: 4 },
  chevron: { width: 20, height: 27, alignItems: "center", justifyContent: "center" },
  fileButton: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, padding: 3 },
  folderName: { flexShrink: 1, fontSize: 13, color: "#111827" },
  untrackedName: { color: "#bc3145" },
  dropTarget: { backgroundColor: "#e9f0ff" },
  count: { flexShrink: 0, fontSize: 11, color: "#9ca3af" },
  path: { flex: 1, fontSize: 13, color: "#1641ad" },
  addedName: { color: "#07833d" },
  removedName: { color: "#bc3145" },
  empty: { padding: 12, color: "#6b7280" },
  footer: { borderTopWidth: 1, borderColor: "#e5e7eb", padding: 10, gap: 7 },
  summaryRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  summaryCount: { color: "#6b7280", fontSize: 12 },
  summaryDetails: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryModified: { color: "#1641ad" },
  message: { minHeight: 58, padding: 8, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 5, textAlignVertical: "top", fontSize: 13, color: "#111827" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  push: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#1664d9", paddingHorizontal: 18, paddingVertical: 7, borderRadius: 5 },
  pushText: { color: "#1664d9", fontWeight: "600" },
  commit: { backgroundColor: "#1664d9", paddingHorizontal: 18, paddingVertical: 8, borderRadius: 5 },
  disabled: { opacity: 0.65 },
  commitText: { color: "#fff", fontWeight: "600" },
  error: { color: "#b91c1c", fontSize: 12 },
  result: { color: "#15803d", fontSize: 12 },
});
