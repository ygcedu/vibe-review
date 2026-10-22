import { ToolbarButton } from "./components/toolbar-button";
import { SourceEditor } from "./components/source-editor";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { workspaceChangePreviewRpc, workspaceChangeApplyRpc, workspaceChangeUndoRpc, type ChangeAction } from "../shared/workspace-commit";
import { ContextMenu } from "./components/context-menu";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
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

// The host's global :focus-visible rule adds an offset outline. This field
// already indicates focus through its border; override the outline on the DOM node.
function setBorderOnlyFocus(input: TextInput | null) {
  if (Platform.OS !== "web" || !input) return;
  const node = input as unknown as HTMLElement;
  node.style.setProperty("outline", "none", "important");
  node.style.setProperty("outline-offset", "0", "important");
}

function CommitActionButton({ label, icon, onPress, disabled = false, loading = false, primary = false, compact = false, danger = false, theme }: {
  label: string; icon: string; onPress(): void; disabled?: boolean; loading?: boolean; primary?: boolean; compact?: boolean; danger?: boolean; theme: PluginWorkspacePanelProps["theme"];
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const colors = theme.colors;
  const foreground = primary ? colors.accentForeground : colors.foreground;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy: loading }} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.actionButton, compact && styles.compactButton, {
      backgroundColor: primary ? danger ? colors.statusDanger : colors.accent : hovered || pressed ? colors.surface2 : compact ? "transparent" : colors.surface1,
      borderColor: focused ? colors.accent : compact ? "transparent" : primary ? danger ? colors.statusDanger : colors.accent : colors.border,
      opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
    }]}>
    {loading ? <ActivityIndicator size="small" color={foreground} /> : <Icon name={icon} size={14} color={foreground} />}
    <Text style={[styles.actionLabel, { color: foreground }]}>{label}</Text>
  </Pressable>;
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

export function WorkspaceCommitPanel({ workspaceId, onFilePreview, externalPreview, onOpenShelfDiff, theme, layout }: PluginWorkspacePanelProps & { onFilePreview: (selection: Selection) => void; externalPreview?: Selection | null; onOpenShelfDiff: () => void }) {
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const [tab, setTab] = useState<"commit" | "shelf">("commit");
  const prepareAction = useRpc(workspaceChangePreviewRpc);
  const applyAction = useRpc(workspaceChangeApplyRpc);
  const undoAction = useRpc(workspaceChangeUndoRpc);
  const [confirmation, setConfirmation] = useState<{ token: string; paths: string[]; action: ChangeAction } | null>(null);
  const [shelfMessage, setShelfMessage] = useState("");
  const [undoId, setUndoId] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const { refresh: refreshDiff } = useGitDiffState(workspaceId);
  const getStatus = useRpc(workspaceGitStatusRpc);
  const trackFiles = useRpc(workspaceGitTrackRpc);
  const commit = useRpc(workspaceGitCommitRpc);
  const push = useRpc(workspaceGitPushRpc);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [messageFocused, setMessageFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [revision, setRevision] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    setConfirmation(null); setSourcePath(null); setUndoId(null); setActivePath(null);
    setSelectedPaths(new Set()); setError(""); setResult("");
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    void getStatus({ workspaceId }).then((value) => {
      if (active) {
        setFiles(value.files);
        setSelectedPaths((current) => new Set([...current].filter((path) => value.files.some((file) => file.path === path))));
        setError("");
      }
    }, (reason: unknown) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [workspaceId, revision]);

  const requestAction = async (action: ChangeAction, targetFiles: File[]) => {
    if (busy || !targetFiles.length) return;
    setBusy(true); setError(""); setResult("");
    try {
      const value = await prepareAction({ workspaceId, action, paths: targetFiles.map((file) => file.path) });
      setShelfMessage(message.trim() || "搁置的更改");
      setConfirmation({ ...value, action });
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const executeAction = async () => {
    if (!confirmation || busy) return;
    setBusy(true); setError("");
    try {
      const value = await applyAction({ workspaceId, token: confirmation.token, message: shelfMessage });
      setUndoId(value.undoId); setResult(value.summary); setError(value.warning ?? ""); setConfirmation(null); refreshDiff();
      setRevision((value) => value + 1);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
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
    setBusy(true); setSubmitting(true);
    try {
      const value = await commit({ workspaceId, message: message.trim(), paths: [...selectedPaths] });
      setResult(value.summary);
      setMessage("");
      setSelectedPaths(new Set());
      setRevision((current) => current + 1);
      setError("");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); setSubmitting(false); }
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
        <ContextMenu theme={theme} compact={layout.compact} label={node.path} style={styles.fileContent} items={[
          { id: "rollback", label: "回滚目录内的更改…", icon: "Undo2", disabled: busy, onSelect: () => requestAction("rollback", node.files) },
          { id: "shelve", label: "搁置目录内的更改…", icon: "Download", disabled: busy, onSelect: () => requestAction("shelve", node.files) },
          { id: "delete", label: "删除目录内的变更文件…", icon: "Trash2", destructive: true, disabled: busy || node.files.some((file) => file.status.includes("D")), onSelect: () => requestAction("delete", node.files) },
          { id: "copy", label: "复制目录路径", icon: "Copy", onSelect: () => copyText(node.path) },
          { id: "toggle", label: isCollapsed ? "展开目录" : "折叠目录", onSelect: () => toggleFolder(key) },
          { id: "select", label: checkboxState(node.files, selectedPaths) === "all" ? "取消选择目录下的文件" : "选择目录下的文件", onSelect: () => toggleSelection(node.files) },
        ]}><Pressable accessibilityRole="button" onPress={() => toggleFolder(key)} style={styles.fileButton}>
          <View style={styles.fileIcon}><Icon name="Folder" size={16} color="#6b7280" /></View>
          <Text style={[styles.folderName, group.title === "未跟踪" && styles.untrackedName]} numberOfLines={1}>{node.name}</Text>
          <Text style={styles.count} numberOfLines={1}>{node.files.length} 个文件</Text>
        </Pressable></ContextMenu>
      </>;
      const rowStyle = [styles.fileRow, { paddingLeft: 29 + depth * 20 }];
      return <View key={key}>
        {group.title === "未跟踪" ? <DraggableRow workspaceId={workspaceId} paths={node.files.map((file) => file.path)} style={rowStyle}>{row}</DraggableRow> : <View style={rowStyle}>{row}</View>}
        {!isCollapsed ? renderNodes(node.children, group, depth + 1) : null}
      </View>;
    }
    const file = node.file;
    const preview = () => { setActivePath(file.path); onFilePreview({ path: file.path, staged: !file.unstaged && file.staged, status: file.untracked ? "??" : file.status }); };
    const row = <>
      <View style={styles.chevron} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedPaths.has(file.path) }} accessibilityLabel={`${selectedPaths.has(file.path) ? "取消选择" : "选择"} ${file.path} 用于提交`} onPress={() => toggleSelection([file])} style={styles.checkbox}>
        <Icon name={checkboxIcon(checkboxState([file], selectedPaths))} size={17} color="#64748b" />
      </Pressable>
      <ContextMenu theme={theme} compact={layout.compact} label={file.path} style={styles.fileContent} items={[
        { id: "diff", label: "查看差异", icon: "FileDiff", onSelect: preview },
        { id: "source", label: "跳转到源码", icon: "Pencil", disabled: busy || file.status.includes("D"), onSelect: () => { setActivePath(file.path); setSourcePath(file.path); } },
        { id: "navigation-separator", separator: true },
        { id: "copy", label: "复制文件路径", icon: "Copy", onSelect: () => copyText(file.path) },
        { id: "select", label: selectedPaths.has(file.path) ? "取消选择用于提交" : "选择用于提交", icon: selectedPaths.has(file.path) ? "Square" : "SquareCheck", onSelect: () => toggleSelection([file]) },
        { id: "git-separator", separator: true },
        { id: "rollback", label: "回滚…", icon: "Undo2", disabled: busy, onSelect: () => requestAction("rollback", [file]) },
        { id: "shelve", label: "搁置更改…", icon: "Download", disabled: busy, onSelect: () => requestAction("shelve", [file]) },
        { id: "refresh", label: "刷新", icon: "RefreshCw", disabled: busy, onSelect: () => setRevision((value) => value + 1) },
        { id: "delete-separator", separator: true },
        { id: "delete", label: "删除…", icon: "Trash2", destructive: true, disabled: busy || file.status.includes("D"), onSelect: () => requestAction("delete", [file]) },
      ]}><Pressable accessibilityRole="button" accessibilityLabel={`查看 ${file.path} 的差异`} onPress={preview} style={styles.fileButton}>
        <View style={styles.fileIcon}><FileTypeIcon fileName={node.name} /></View>
        <Text style={[styles.path, fileNameColor(file)]} numberOfLines={1}>{node.name}</Text>
      </Pressable></ContextMenu>
    </>;
    const rowStyle = [styles.fileRow, { paddingLeft: 29 + depth * 20 }, externalPreview?.path === file.path && styles.active];
    return group.title === "未跟踪"
      ? <DraggableRow key={`${group.title}:${file.path}`} workspaceId={workspaceId} paths={[file.path]} style={rowStyle}>{row}</DraggableRow>
      : <View key={`${group.title}:${file.path}`} style={rowStyle}>{row}</View>;
  });

  const actionFiles = selectedFiles.length ? selectedFiles : files.filter((file) => file.path === (activePath ?? externalPreview?.path));
  const allCollapsed = groups.every((group) => collapsedGroups.has(group.title));
  const collapseAll = () => {
    const keys = new Set<string>();
    const visit = (nodes: TreeNode[], group: string) => { for (const node of nodes) if (node.kind === "folder") { keys.add(`${group}:${node.path}`); visit(node.children, group); } };
    for (const group of groups) visit(buildFileTree(group.files, true), group.title);
    setCollapsed(keys); setCollapsedGroups(new Set(groups.map((group) => group.title)));
  };
  return <View style={styles.root}>
    <View style={styles.tabs} accessibilityRole="tablist">
      {(["commit", "shelf"] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.selectedTab]}>
        <Text style={[styles.tabText, tab === value && styles.selectedTabText]}>{value === "commit" ? "Commit" : "Shelf"}</Text>
      </Pressable>)}
    </View>
    {tab === "shelf" ? <Shelf workspaceId={workspaceId} theme={theme} compact={layout.compact} onOpenDiff={onOpenShelfDiff} /> : <>
    <View onLayout={(event) => setToolbarWidth(event.nativeEvent.layout.width)} style={[styles.operationBar, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface0 }]}>
      {([
        ["刷新 Git 状态", "RefreshCw", () => { setRevision((value) => value + 1); refreshDiff(); }, busy],
        ["回滚所选更改", "Undo2", () => void requestAction("rollback", actionFiles), busy || !actionFiles.length],
        ["搁置所选更改", "Download", () => void requestAction("shelve", actionFiles), busy || !actionFiles.length],
        [allCollapsed ? "全部展开" : "全部折叠", allCollapsed ? "ChevronsUpDown" : "ChevronsDownUp", () => {
          if (allCollapsed) { setCollapsed(new Set()); setCollapsedGroups(new Set()); }
          else collapseAll();
        }, false],
      ] as const).map(([label, icon, onPress, disabled], index) => <ToolbarButton key={index} label={label} icon={icon} onPress={onPress} disabled={disabled} theme={theme} boundary={{ width: toolbarWidth }} />)}
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
        const hasFiles = group.files.length > 0;
        const content = <View>
          <ContextMenu theme={theme} compact={layout.compact} label={`${group.title}文件`} items={[
            ...(group.title === "未跟踪" ? [{ id: "track", label: "全部加入 Git", icon: "Plus", disabled: busy || !hasFiles, onSelect: () => track(group.files.map((file) => file.path)) }] : []),
            { id: "rollback", label: "回滚分组内的更改…", icon: "Undo2", disabled: busy || !hasFiles, onSelect: () => requestAction("rollback", group.files) },
            { id: "shelve", label: "搁置分组内的更改…", icon: "Download", disabled: busy || !hasFiles, onSelect: () => requestAction("shelve", group.files) },
            { id: "destructive", separator: true },
            { id: "delete", label: "删除分组内的文件…", icon: "Trash2", destructive: true, disabled: busy || !hasFiles || group.files.some((file) => file.status.includes("D")), onSelect: () => requestAction("delete", group.files) },
          ]}>
            {group.title === "未跟踪" && hasFiles
              ? <DraggableRow workspaceId={workspaceId} paths={group.files.map((file) => file.path)} style={[styles.groupRow, { flex: 1 }]}>{header}</DraggableRow>
              : <View style={[styles.groupRow, { flex: 1 }]}>{header}</View>}
          </ContextMenu>
          {!isCollapsed ? renderNodes(buildFileTree(group.files, true), group, 0) : null}
        </View>;
        return group.title === "已跟踪"
          ? <TrackedDropZone key={group.title} workspaceId={workspaceId} onFiles={(paths) => void track(files.filter((file) => file.untracked && paths.includes(file.path)).map((file) => file.path))}>{content}</TrackedDropZone>
          : <View key={group.title}>{content}</View>;
      })}
      {files.length === 0 && !error ? <Text style={styles.empty}>工作区没有待提交的改动</Text> : null}
    </ScrollView>
    <View style={[styles.footer, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface0 }]}>
      {selectedFiles.length > 0 ? <View style={styles.summaryRow}>
        <Text style={styles.summaryCount}>已选 {selectedFiles.length} 个文件</Text>
        <View style={styles.summaryDetails}>
          {counts.added > 0 ? <Text style={styles.addedName}>新增 {counts.added}</Text> : null}
          {counts.modified > 0 ? <Text style={styles.summaryModified}>修改 {counts.modified}</Text> : null}
          {counts.deleted > 0 ? <Text style={styles.removedName}>删除 {counts.deleted}</Text> : null}
        </View>
      </View> : null}
      <TextInput ref={setBorderOnlyFocus} value={message} onChangeText={setMessage} onFocus={() => setMessageFocused(true)} onBlur={() => setMessageFocused(false)} multiline accessibilityLabel="提交说明" placeholder="填写提交说明…" placeholderTextColor={theme.colors.foregroundMuted} style={[styles.message, { color: theme.colors.foreground, borderWidth: messageFocused ? 2 : 1, padding: messageFocused ? 9 : 10, borderColor: messageFocused ? theme.colors.accent : theme.colors.border, backgroundColor: theme.colors.surface1 }]} />
      <View style={styles.actions}>
        <CommitActionButton label={pushing ? "推送中…" : "推送"} icon="ArrowUp" theme={theme} disabled={busy} loading={pushing} onPress={() => void pushBranch()} />
        <CommitActionButton label={submitting ? "提交中…" : "提交"} icon="GitCommitHorizontal" theme={theme} primary loading={submitting} disabled={busy || !selectedPaths.size || !message.trim()} onPress={() => void submit()} />
      </View>
      {error ? <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.feedback, { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border }]}>
        <Icon name="CircleAlert" size={15} color={theme.colors.statusDanger} />
        <Text selectable style={[styles.feedbackText, { color: theme.colors.statusDanger }]}>{error}</Text>
      </View> : null}
      {result || undoId ? <View accessibilityLiveRegion="polite" style={styles.resultFeedback}>
        <Icon name="CircleCheck" size={15} color={theme.colors.statusSuccess} />
        <Text selectable style={[styles.feedbackText, { color: theme.colors.foreground }]}>{result || "文件操作已完成"}</Text>
        {undoId ? <CommitActionButton label="撤销" icon="Undo2" compact theme={theme} disabled={busy} onPress={() => {
          setBusy(true); setError("");
          void undoAction({ workspaceId, undoId }).then(() => { setResult(""); setUndoId(null); refreshDiff(); setRevision((value) => value + 1); }, (reason) => setError(String(reason))).finally(() => setBusy(false));
        }} /> : <Pressable accessibilityRole="button" accessibilityLabel="关闭操作提示" hitSlop={4} onPress={() => setResult("")} style={styles.dismissFeedback}><Icon name="X" size={14} color={theme.colors.foregroundMuted} /></Pressable>}
      </View> : null}
    </View>
    </>}
    {confirmation ? <Modal title={confirmation.action === "rollback" ? "回滚更改" : confirmation.action === "delete" ? "删除文件" : "搁置更改"} open onOpenChange={(open) => { if (!open && !busy) { setConfirmation(null); setError(""); } }}><Modal.Content contentContainerStyle={styles.confirmContent}>
      <Text style={[styles.confirmDescription, { color: theme.colors.foreground }]}>{confirmation.action === "rollback" ? "文件将恢复到 HEAD，暂存的改动也会清除。新增和未跟踪文件将被移除。" : confirmation.action === "delete" ? "文件将从工作区删除，Git 暂存区保持不变。" : "改动将保存到 Shelf，工作区和暂存区将恢复到 HEAD。"}</Text>
      <View style={[styles.confirmFiles, { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border }]}>
        <Text style={[styles.confirmCaption, { color: theme.colors.foregroundMuted }]}>涉及 {confirmation.paths.length} 个文件</Text>
        <ScrollView style={styles.confirmFileList}>
          {confirmation.paths.map((path) => <View key={path} style={styles.confirmFileRow}>
            <View style={styles.fileIcon}><FileTypeIcon fileName={path} /></View>
            <Text selectable style={[styles.confirmPath, { color: theme.colors.foreground }]}>{path}</Text>
          </View>)}
        </ScrollView>
      </View>
      <View style={styles.confirmNote}>
        <Icon name="Undo2" size={13} color={theme.colors.foregroundMuted} />
        <Text style={[styles.confirmCaption, { flex: 1, color: theme.colors.foregroundMuted }]}>操作前会保留恢复副本，完成后可撤销。</Text>
      </View>
      {confirmation.action === "shelve" ? <TextInput accessibilityLabel="搁置说明" value={shelfMessage} onChangeText={setShelfMessage} editable={!busy} placeholder="搁置说明" placeholderTextColor={theme.colors.foregroundMuted} style={[styles.message, { color: theme.colors.foreground, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }]} /> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.statusDanger }]}>{error}</Text> : null}
      <View style={[styles.confirmActions, { borderColor: theme.colors.border }]}>
        <CommitActionButton label="取消" icon="X" theme={theme} disabled={busy} onPress={() => { setConfirmation(null); setError(""); }} />
        <CommitActionButton label={busy ? "处理中…" : confirmation.action === "rollback" ? "回滚更改" : confirmation.action === "delete" ? "删除文件" : "搁置更改"} icon={confirmation.action === "rollback" ? "Undo2" : confirmation.action === "delete" ? "Trash2" : "Download"} primary danger={confirmation.action !== "shelve"} theme={theme} disabled={busy} loading={busy} onPress={() => void executeAction()} />
      </View>
    </Modal.Content></Modal> : null}
    {sourcePath ? <SourceEditor key={`${workspaceId}:${sourcePath}`} workspaceId={workspaceId} path={sourcePath} theme={theme} onClose={() => setSourcePath(null)} onSaved={() => { setRevision((value) => value + 1); refreshDiff(); }} /> : null}
  </View>;
}

function Shelf({ workspaceId, onOpenDiff, theme, compact }: { workspaceId: string; onOpenDiff: () => void; theme: PluginWorkspacePanelProps["theme"]; compact: boolean }) {
  const [toolbarWidth, setToolbarWidth] = useState(0);
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
          <View style={styles.fileButton}><View style={styles.fileIcon}><Icon name="Folder" size={16} color="#6b7280" /></View><Text style={styles.folderName} numberOfLines={1}>{node.name}</Text><Text style={styles.count}>{node.files.length} 个文件</Text></View>
        </Pressable>
        {!closed ? renderTree(entry, node.children, depth + 1) : null}
      </View>;
    }
    const path = node.file.path;
    const preview = () => {
      openTab({ id: `shelf:${entry.id}:${path}`, source: "shelf", entryId: entry.id, label: entry.message, path });
      onOpenDiff();
    };
    return <View key={path} style={[styles.fileRow, { paddingLeft: 29 + depth * 20 }, activeTab?.source === "shelf" && activeTab.entryId === entry.id && activeTab.path === path && styles.active]}>
      <View style={styles.chevron} />
      <ContextMenu theme={theme} compact={compact} label={path} style={styles.fileContent} items={[
        { id: "diff", label: "查看暂存差异", icon: "FileDiff", onSelect: preview },
        { id: "copy", label: "复制文件路径", icon: "Copy", onSelect: () => copyText(path) },
      ]}><Pressable accessibilityRole="button" accessibilityLabel={`查看暂存 ${path} 的差异`} style={styles.fileButton} onPress={preview}><View style={styles.fileIcon}><FileTypeIcon fileName={node.name} /></View><Text style={styles.path} numberOfLines={1}>{node.name}</Text></Pressable></ContextMenu>
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
    <View onLayout={(event) => setToolbarWidth(event.nativeEvent.layout.width)} style={[styles.operationBar, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface0 }]}>
      <ToolbarButton label="刷新 Shelf" icon="RefreshCw" onPress={() => setRevision((value) => value + 1)} disabled={loading} theme={theme} boundary={{ width: toolbarWidth }} />
    </View>
    <ScrollView style={styles.listExpanded}>
      {loading ? <Text style={styles.empty}>加载暂存内容…</Text> : error ? <Text style={[styles.empty, styles.error]}>{error}</Text> : entries.length === 0 ? <Text style={styles.empty}>没有暂存的更改（Shelf / Git stash）</Text> : entries.map((entry) => <View key={entry.id} style={styles.shelfEntry}>
        <ContextMenu theme={theme} compact={compact} label={entry.message} items={[
          { id: "copy", label: "复制暂存说明", icon: "Copy", onSelect: () => copyText(entry.message) },
          { id: "toggle", label: expanded.has(entry.id) ? "折叠暂存文件" : "展开暂存文件", onSelect: () => setExpanded((current) => {
            const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next;
          }) },
        ]}><Pressable accessibilityRole="button" accessibilityLabel={`${expanded.has(entry.id) ? "折叠" : "展开"} ${entry.message}`} accessibilityState={{ expanded: expanded.has(entry.id) }} style={[styles.shelfRow, { flex: 1 }]} onPress={() => setExpanded((current) => {
          const next = new Set(current);
          if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
          return next;
        })}>
          <Icon name={expanded.has(entry.id) ? "ChevronDown" : "ChevronRight"} size={15} color="#64748b" />
          <View style={styles.shelfInfo}>
            <Text style={styles.shelfMessage} numberOfLines={2}>{entry.message}</Text>
            <Text style={styles.shelfMeta}>{entry.ref} · {entry.files.length} 个文件 · {entry.date ? new Date(entry.date).toLocaleString() : "时间未知"}</Text>
          </View>
        </Pressable></ContextMenu>
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
  tabText: { fontSize: 14, fontWeight: "400", color: "#64748b" },
  selectedTabText: { color: "#1641ad" },
  shelfEntry: { borderBottomWidth: 1, borderColor: "#f1f5f9" },
  shelfRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  shelfInfo: { flex: 1, minWidth: 0, gap: 4 },
  shelfMessage: { fontSize: 13, color: "#111827" },
  shelfMeta: { fontSize: 11, color: "#64748b" },
  operationBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: 1, gap: 2, zIndex: 20 },
  listExpanded: { flex: 1, minHeight: 0 },
  groupRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 9, paddingTop: 10, paddingBottom: 4 },
  group: { fontSize: 12, fontWeight: "600", color: "#6b7280" },
  groupButton: { flex: 1, minHeight: 27, justifyContent: "center" },
  fileRow: { flexDirection: "row", alignItems: "center", minHeight: 32, paddingHorizontal: 9 },
  active: { backgroundColor: "#e9f0ff" },
  checkbox: { flexShrink: 0, padding: 4 },
  chevron: { flexShrink: 0, width: 20, height: 27, alignItems: "center", justifyContent: "center" },
  fileContent: { flex: 1, minWidth: 0 },
  fileIcon: { width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  fileButton: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, padding: 3 },
  folderName: { minWidth: 0, flexShrink: 1, fontSize: 13, color: "#111827" },
  untrackedName: { color: "#bc3145" },
  dropTarget: { backgroundColor: "#e9f0ff" },
  count: { flexShrink: 0, fontSize: 11, color: "#9ca3af" },
  path: { flex: 1, minWidth: 0, fontSize: 13, color: "#1641ad" },
  addedName: { color: "#07833d" },
  removedName: { color: "#bc3145" },
  empty: { padding: 12, color: "#6b7280" },
  footer: { borderTopWidth: 1, borderColor: "#e5e7eb", padding: 12, gap: 8 },
  summaryRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  summaryCount: { color: "#6b7280", fontSize: 12 },
  summaryDetails: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryModified: { color: "#1641ad" },
  message: { outlineWidth: 0, minHeight: 64, padding: 10, borderWidth: 1, borderRadius: 8, textAlignVertical: "top", fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  actionButton: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1 },
  compactButton: { minHeight: 28, paddingHorizontal: 4, gap: 3, borderWidth: 0 },
  actionLabel: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  feedback: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderWidth: 1, borderRadius: 8 },
  resultFeedback: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  confirmContent: { padding: 20, gap: 12 },
  confirmDescription: { fontSize: 13, lineHeight: 21 },
  confirmFiles: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  confirmCaption: { fontSize: 12, lineHeight: 18 },
  confirmFileList: { maxHeight: 180 },
  confirmFileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  confirmPath: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  confirmNote: { flexDirection: "row", alignItems: "center", gap: 6 },
  confirmActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, borderTopWidth: 1, paddingTop: 16, marginTop: 4 },
  feedbackText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  dismissFeedback: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.45 },
  error: { color: "#b91c1c", fontSize: 12 },
  result: { color: "#15803d", fontSize: 12 },
});
