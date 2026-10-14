import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { workspaceGitCommitRpc, workspaceGitDiffRpc, workspaceGitPushRpc, workspaceGitTrackRpc, workspaceGitStatusRpc } from "../shared/workspace-commit";
import { parseDiffFiles } from "./diff/diff";
import { FileTypeIcon } from "./diff/file-icons";
import { SplitDiff } from "./diff/split-diff";
import { DiffOptionButton, WrapToggleButton } from "./diff/wrap-toggle";
import { compactTree, sortTreeNodes } from "./diff/file-tree-utils";

type File = { path: string; status: string; staged: boolean; unstaged: boolean; untracked: boolean };
type Selection = { path: string; staged: boolean; status?: string };
type TreeNode = { kind: "folder"; name: string; path: string; files: File[]; children: TreeNode[] } | { kind: "file"; name: string; file: File };
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

function fileTree(files: File[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, Extract<TreeNode, { kind: "folder" }>>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let children = root;
    let path = "";
    for (const name of parts.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: "folder", name, path, files: [], children: [] };
        folders.set(path, folder);
        children.push(folder);
      }
      folder.files.push(file);
      children = folder.children;
    }
    children.push({ kind: "file", name: parts.at(-1) ?? file.path, file });
  }
  sortTreeNodes(root);
  return compactTree(root);
}

export function WorkspaceCommitPanel({ workspaceId, onFilePreview, externalPreview }: PluginWorkspacePanelProps & { onFilePreview?: (selection: Selection) => void; externalPreview?: Selection | null }) {
  const getStatus = useRpc(workspaceGitStatusRpc);
  const getDiff = useRpc(workspaceGitDiffRpc);
  const trackFiles = useRpc(workspaceGitTrackRpc);
  const commit = useRpc(workspaceGitCommitRpc);
  const push = useRpc(workspaceGitPushRpc);
  const [files, setFiles] = useState<File[]>([]);
  const [branch, setBranch] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [diff, setDiff] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [revision, setRevision] = useState(0);
  const [wrapLines, setWrapLines] = useState(false);
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);
  const [syncScrolling, setSyncScrolling] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [previewHeight, setPreviewHeight] = useState(0);
  const [previewHeaderHeight, setPreviewHeaderHeight] = useState(0);

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

  useEffect(() => {
    let active = true;
    setDiff("");
    if (!onFilePreview && selected) void getDiff({ workspaceId, path: selected.path, staged: selected.staged }).then(
      (value) => { if (active) setDiff(value.diff); },
      (reason: unknown) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [workspaceId, selected?.path, selected?.staged, revision]);

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
      setSelected(null);
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
      setSelected(null);
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
  const parsed = useMemo(() => parseDiffFiles(diff), [diff]);
  const loadFullDiff = async () => {
    if (!selected) return null;
    const result = await getDiff({ workspaceId, path: selected.path, staged: selected.staged, fullContext: true });
    return parseDiffFiles(result.diff)[0] ?? null;
  };
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
        if (onFilePreview) onFilePreview(selection);
        else setSelected(selection);
      }} style={styles.fileButton}>
        <FileTypeIcon fileName={node.name} />
        <Text style={[styles.path, fileNameColor(file)]} numberOfLines={1}>{node.name}</Text>
      </Pressable>
    </>;
    const rowStyle = [styles.fileRow, { paddingLeft: 29 + depth * 20 }, (onFilePreview ? externalPreview?.path === file.path : selected?.path === file.path) && styles.active];
    return group.title === "未跟踪"
      ? <DraggableRow key={`${group.title}:${file.path}`} workspaceId={workspaceId} paths={[file.path]} style={rowStyle}>{row}</DraggableRow>
      : <View key={`${group.title}:${file.path}`} style={rowStyle}>{row}</View>;
  });

  return <View style={styles.root}>
    <View style={styles.toolbar}>
      <Text style={styles.heading}>提交更改{branch ? ` · ${branch}` : ""}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="刷新 Git 状态" onPress={() => setRevision((value) => value + 1)}><Icon name="RefreshCw" size={17} color="#64748b" /></Pressable>
    </View>
    <ScrollView style={!onFilePreview && selected ? styles.list : styles.listExpanded}>
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
          {!isCollapsed ? renderNodes(fileTree(group.files), group, 0) : null}
        </View>;
        return group.title === "已跟踪"
          ? <TrackedDropZone key={group.title} workspaceId={workspaceId} onFiles={(paths) => void track(files.filter((file) => file.untracked && paths.includes(file.path)).map((file) => file.path))}>{content}</TrackedDropZone>
          : <View key={group.title}>{content}</View>;
      })}
      {files.length === 0 && !error ? <Text style={styles.empty}>工作区没有待提交的改动</Text> : null}
    </ScrollView>
    {!onFilePreview && selected ? <View style={styles.preview} onLayout={(event) => setPreviewHeight(event.nativeEvent.layout.height)}>
      <View style={styles.previewHeader} onLayout={(event) => setPreviewHeaderHeight(event.nativeEvent.layout.height)}>
        <Text style={styles.previewTitle} numberOfLines={1}>{selected.path}</Text>
        <View style={styles.previewActions}><DiffOptionButton active={collapseUnchanged} onToggle={() => setCollapseUnchanged((value) => !value)} label="折叠未变更代码" icon="ChevronsDownUp" /><DiffOptionButton active={syncScrolling} onToggle={() => setSyncScrolling((value) => !value)} label="左右同步滚动" icon="ArrowDownUp" /><WrapToggleButton active={wrapLines} onToggle={() => setWrapLines((value) => !value)} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭文件差异预览" onPress={() => setSelected(null)} style={styles.previewAction}><Icon name="X" size={16} color="#64748b" /></Pressable>
      </View>
      {parsed[0] && previewHeight > previewHeaderHeight ? <SplitDiff key={`${selected.path}:${selected.staged}`} file={parsed[0]} wrapLines={wrapLines} collapseUnchanged={collapseUnchanged} syncScrolling={syncScrolling} loadFullFile={loadFullDiff} maxHeight={Math.max(32, previewHeight - previewHeaderHeight - 1)} /> : !parsed[0] ? <Text style={styles.empty}>没有可显示的文本差异</Text> : null}
    </View> : null}
    <View style={styles.footer}>
      {selectedFiles.length > 0 ? <View style={styles.summaryRow}>
        <Text style={styles.summaryCount}>已选 {selectedFiles.length} 个文件</Text>
        <View style={styles.summaryDetails}>
          {counts.added > 0 ? <Text style={styles.addedName}>新增 {counts.added}</Text> : null}
          {counts.modified > 0 ? <Text style={styles.summaryModified}>修改 {counts.modified}</Text> : null}
          {counts.deleted > 0 ? <Text style={styles.removedName}>删除 {counts.deleted}</Text> : null}
        </View>
      </View> : null}
      <TextInput value={message} onChangeText={setMessage} multiline placeholder="提交说明" style={styles.message} />
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="推送当前分支" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void pushBranch()} style={[styles.push, busy && styles.disabled]}><Text style={styles.pushText}>{pushing ? "推送中…" : "推送"}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="提交勾选的文件" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void submit()} style={[styles.commit, busy && styles.disabled]}><Text style={styles.commitText}>{busy && !pushing ? "提交中…" : "提交"}</Text></Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {result ? <Text style={styles.result}>{result}</Text> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", backgroundColor: "#fff" },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  heading: { fontSize: 15, fontWeight: "600", color: "#111827" },
  list: { flexGrow: 0, flexShrink: 1, maxHeight: 280 },
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
  preview: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", borderTopWidth: 1, borderColor: "#e5e7eb" },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 9, position: "relative", zIndex: 3 },
  previewActions: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 0 },
  previewTitle: { flex: 1, fontSize: 13, color: "#111827" },
  previewAction: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  footer: { borderTopWidth: 1, borderColor: "#e5e7eb", padding: 10, gap: 7 },
  summaryRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  summaryCount: { color: "#6b7280", fontSize: 12 },
  summaryDetails: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryModified: { color: "#1641ad" },
  message: { minHeight: 58, padding: 8, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 5, textAlignVertical: "top", fontSize: 13 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  push: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#1664d9", paddingHorizontal: 18, paddingVertical: 7, borderRadius: 5 },
  pushText: { color: "#1664d9", fontWeight: "600" },
  commit: { backgroundColor: "#1664d9", paddingHorizontal: 18, paddingVertical: 8, borderRadius: 5 },
  disabled: { opacity: 0.65 },
  commitText: { color: "#fff", fontWeight: "600" },
  error: { color: "#b91c1c", fontSize: 12 },
  result: { color: "#15803d", fontSize: 12 },
});
