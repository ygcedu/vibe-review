import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { gitCommitDetailRpc, gitCommitFileDiffRpc, gitHistoryRpc } from "../shared/git-history";
import { workspaceGitDiffRpc } from "../shared/workspace-commit";
import { parseDiffFiles } from "./diff";
import { FileTypeIcon } from "./file-icons";
import { SplitDiff } from "./split-diff";
import { WorkspaceCommitPanel } from "./workspace-commit";
import { WrapToggleButton } from "./wrap-toggle";

type Commit = { hash: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string[] };
type ChangedFile = { path: string; status: string };
type TreeNode = { kind: "folder"; name: string; path: string; count: number; children: TreeNode[] } | { kind: "file"; name: string; file: ChangedFile };
type Branch = { name: string; group: "local" | "remote" };
type BranchNode = { kind: "folder"; name: string; path: string; children: BranchNode[] } | { kind: "branch"; name: string; fullName: string };

function branchTree(branches: Branch[], group: Branch["group"]): BranchNode[] {
  const root: BranchNode[] = [];
  const folders = new Map<string, Extract<BranchNode, { kind: "folder" }>>();
  for (const branch of branches.filter((item) => item.group === group)) {
    const parts = branch.name.split("/");
    let children = root;
    let path = group;
    for (const name of parts.slice(0, -1)) {
      path += `/${name}`;
      let folder = folders.get(path);
      if (!folder) { folder = { kind: "folder", name, path, children: [] }; folders.set(path, folder); children.push(folder); }
      children = folder.children;
    }
    children.push({ kind: "branch", name: parts.at(-1) ?? branch.name, fullName: branch.name });
  }
  const sort = (nodes: BranchNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1);
    nodes.forEach((node) => { if (node.kind === "folder") sort(node.children); });
  };
  sort(root);
  return root;
}

function tree(files: ChangedFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, Extract<TreeNode, { kind: "folder" }>>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let children = root;
    let path = "";
    for (const name of parts.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let folder = folders.get(path);
      if (!folder) { folder = { kind: "folder", name, path, count: 0, children: [] }; folders.set(path, folder); children.push(folder); }
      folder.count++;
      children = folder.children;
    }
    children.push({ kind: "file", name: parts.at(-1) ?? file.path, file });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1);
    nodes.forEach((node) => { if (node.kind === "folder") sort(node.children); });
  };
  sort(root);
  const compact = (nodes: TreeNode[]): TreeNode[] => nodes.map((node) => {
    if (node.kind === "folder") {
      node.children = compact(node.children);
      while (node.children.length === 1 && node.children[0]?.kind === "folder") {
        const child = node.children[0];
        node.name += `/${child.name}`;
        node.path = child.path;
        node.children = child.children;
      }
    }
    return node;
  });
  return compact(root);
}

function fileColor(status: string) {
  if (status.startsWith("D")) return styles.deleted;
  if (status.startsWith("A")) return styles.added;
  return styles.modified;
}

export function GitHistoryPanel(props: PluginWorkspacePanelProps) {
  const { workspaceId } = props;
  const getHistory = useRpc(gitHistoryRpc);
  const getDetail = useRpc(gitCommitDetailRpc);
  const getFileDiff = useRpc(gitCommitFileDiffRpc);
  const getWorkingDiff = useRpc(workspaceGitDiffRpc);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [branch, setBranch] = useState("");
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ message: string; files: ChangedFile[] } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [workingFile, setWorkingFile] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [branchCollapsed, setBranchCollapsed] = useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [diffHeight, setDiffHeight] = useState(0);
  const [wrapLines, setWrapLines] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => { setSkip(0); setQuery(searchText); }, 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getHistory({ workspaceId, branch, query, skip }).then((value) => {
      if (!active) return;
      setCommits((existing) => skip === 0 ? value.commits : [...existing, ...value.commits]);
      setBranches(value.branches);
      setCurrentBranch(value.currentBranch);
      setHasMore(value.hasMore);
      if (skip === 0) setSelectedHash(value.commits[0]?.hash ?? null);
      setError("");
    }, (reason: unknown) => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, branch, query, skip, revision]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setSelectedFile(null);
    setWorkingFile(null);
    setDiff("");
    if (selectedHash) void getDetail({ workspaceId, hash: selectedHash }).then((value) => {
      if (!active) return;
      setDetail(value);
      setCollapsed(new Set());
    }, (reason: unknown) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [workspaceId, selectedHash]);

  useEffect(() => {
    let active = true;
    setDiff("");
    if (!workingFile && selectedHash && selectedFile) void getFileDiff({ workspaceId, hash: selectedHash, path: selectedFile }).then(
      (value) => { if (active) setDiff(value.diff); },
      (reason: unknown) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [workspaceId, selectedHash, selectedFile, workingFile?.path]);

  useEffect(() => {
    let active = true;
    if (workingFile) {
      setDiff("");
      void getWorkingDiff({ workspaceId, ...workingFile }).then(
        (value) => { if (active) setDiff(value.diff); },
        (reason: unknown) => { if (active) setError(String(reason)); },
      );
    }
    return () => { active = false; };
  }, [workspaceId, workingFile?.path, workingFile?.staged]);

  const toggleFolder = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  const toggleBranchFolder = (path: string) => setBranchCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  const chooseBranch = (name: string) => { setBranch(name); setSkip(0); };
  const renderBranches = (nodes: BranchNode[], depth: number): React.ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") return <View key={node.path}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${branchCollapsed.has(node.path) ? "展开" : "折叠"} ${node.name}`} onPress={() => toggleBranchFolder(node.path)} style={[styles.branchRow, { paddingLeft: 14 + depth * 18 }]}>
        <Icon name={branchCollapsed.has(node.path) ? "ChevronRight" : "ChevronDown"} size={14} color="#64748b" />
        <Icon name="Folder" size={15} color="#64748b" />
        <Text style={styles.branchName} numberOfLines={1}>{node.name}</Text>
      </Pressable>
      {!branchCollapsed.has(node.path) ? renderBranches(node.children, depth + 1) : null}
    </View>;
    return <Pressable key={node.fullName} accessibilityRole="button" accessibilityLabel={`查看分支 ${node.fullName}`} accessibilityState={{ selected: branch === node.fullName }} onPress={() => chooseBranch(node.fullName)} style={[styles.branchRow, { paddingLeft: 14 + depth * 18 }, branch === node.fullName && styles.selected]}>
      <View style={styles.branchIndent} />
      <Icon name={node.fullName === currentBranch ? "GitBranch" : "GitCommitHorizontal"} size={14} color={node.fullName === currentBranch ? "#0f8b59" : "#64748b"} />
      <Text style={[styles.branchName, branch === node.fullName && styles.activeBranch]} numberOfLines={1}>{node.name}</Text>
      {node.fullName === currentBranch ? <Text style={styles.currentMarker}>当前</Text> : null}
    </Pressable>;
  });
  const renderFiles = (nodes: TreeNode[], depth: number): React.ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") return <View key={node.path}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${collapsed.has(node.path) ? "展开" : "折叠"} ${node.path}`} onPress={() => toggleFolder(node.path)} style={[styles.fileRow, { paddingLeft: 8 + depth * 18 }]}>
        <Icon name={collapsed.has(node.path) ? "ChevronRight" : "ChevronDown"} size={14} color="#64748b" />
        <Icon name="Folder" size={16} color="#64748b" />
        <Text style={styles.folderName} numberOfLines={1}>{node.name}</Text>
        <Text style={styles.count}>{node.count} 个文件</Text>
      </Pressable>
      {!collapsed.has(node.path) ? renderFiles(node.children, depth + 1) : null}
    </View>;
    return <Pressable key={node.file.path} accessibilityRole="button" accessibilityLabel={`查看 ${node.file.path} 的提交差异`} onPress={() => { setWorkingFile(null); setSelectedFile(node.file.path); }} style={[styles.fileRow, { paddingLeft: 8 + depth * 18 }, selectedFile === node.file.path && styles.selected]}>
      <View style={styles.fileIndent} />
      <FileTypeIcon fileName={node.name} />
      <Text style={[styles.fileName, fileColor(node.file.status)]} numberOfLines={1}>{node.name}</Text>
    </Pressable>;
  });
  const selectedCommit = commits.find((item) => item.hash === selectedHash);
  const parsed = parseDiffFiles(diff);
  const previewPath = workingFile?.path ?? selectedFile;
  const contentHeight = Math.max(0, panelHeight - toolbarHeight);
  const topHeight = Math.round(contentHeight * 0.53);
  const bottomHeight = contentHeight - topHeight;
  const contentWidth = Math.max(panelWidth, 1000);

  return <View style={styles.root} onLayout={(event) => { setPanelWidth(event.nativeEvent.layout.width); setPanelHeight(event.nativeEvent.layout.height); }}>
    <View style={styles.toolbar} onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}><Text style={styles.heading}>Git 历史</Text><Pressable accessibilityRole="button" accessibilityLabel="刷新提交历史" onPress={() => { setSkip(0); setRevision((value) => value + 1); }}><Icon name="RefreshCw" size={17} color="#64748b" /></Pressable></View>
    <ScrollView horizontal style={[styles.horizontalViewport, { height: topHeight }]} contentContainerStyle={styles.horizontalContent} nestedScrollEnabled>
      <View style={[styles.topRow, { width: contentWidth, height: topHeight }]}>
        <View style={styles.commitArea}><WorkspaceCommitPanel {...props} externalPreview={workingFile} onFilePreview={(selection) => { setSelectedFile(null); setWorkingFile(selection); }} /></View>
        <View style={styles.topDiff} onLayout={(event) => setDiffHeight(event.nativeEvent.layout.height)}>
          <View style={styles.diffHeader}>
            <Text style={styles.diffPath} numberOfLines={1}>{previewPath ? `${workingFile ? "Working Diff" : "Repository Diff"}: ${previewPath}` : "Diff 预览"}</Text>
            {previewPath ? <>
              <WrapToggleButton active={wrapLines} onToggle={() => setWrapLines((value) => !value)} tooltipPlacement="below" />
              <Pressable accessibilityRole="button" accessibilityLabel="关闭差异预览" onPress={() => { setWorkingFile(null); setSelectedFile(null); setDiff(""); }} style={styles.diffAction}><Icon name="X" size={16} color="#64748b" /></Pressable>
            </> : null}
          </View>
          {previewPath && parsed[0] && diffHeight > 40 ? <SplitDiff file={parsed[0]} wrapLines={wrapLines} maxHeight={Math.max(32, diffHeight - 39)} /> : <Text style={styles.empty}>{previewPath ? "没有可显示的文本差异" : "点击左侧或下方变更文件，在这里查看 Diff"}</Text>}
        </View>
      </View>
    </ScrollView>
    <ScrollView horizontal style={[styles.horizontalViewport, styles.bottomViewport, { height: bottomHeight }]} contentContainerStyle={styles.horizontalContent} nestedScrollEnabled>
      <View style={[styles.columns, { width: contentWidth, height: bottomHeight }]}>
        <View style={styles.sidebar}>
          <Text style={styles.columnHeading}>分支</Text>
          <ScrollView style={styles.sidebarScroll}>
            <Pressable accessibilityRole="button" accessibilityLabel="查看全部分支的提交" accessibilityState={{ selected: branch === "" }} onPress={() => chooseBranch("")} style={[styles.branchRow, branch === "" && styles.selected]}><Icon name="GitBranch" size={15} color="#64748b" /><Text style={[styles.branchName, branch === "" && styles.activeBranch]}>全部提交</Text></Pressable>
            {currentBranch ? <Pressable accessibilityRole="button" accessibilityLabel={`查看当前分支 ${currentBranch}`} onPress={() => chooseBranch(currentBranch)} style={styles.branchRow}><Icon name="GitCommitHorizontal" size={15} color="#64748b" /><Text style={styles.branchName} numberOfLines={1}>HEAD · {currentBranch}</Text></Pressable> : null}
            {(["local", "remote"] as const).map((group) => <View key={group}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${branchCollapsed.has(group) ? "展开" : "折叠"}${group === "local" ? "本地" : "远程"}分支`} onPress={() => toggleBranchFolder(group)} style={styles.branchGroup}><Icon name={branchCollapsed.has(group) ? "ChevronRight" : "ChevronDown"} size={14} color="#64748b" /><Text style={styles.branchGroupText}>{group === "local" ? "本地" : "远程"}</Text><Text style={styles.branchCount}>{branches.filter((item) => item.group === group).length}</Text></Pressable>
              {!branchCollapsed.has(group) ? renderBranches(branchTree(branches, group), 0) : null}
            </View>)}
          </ScrollView>
        </View>
        <View style={styles.logColumn}>
          <View style={styles.logToolbar}><Text style={styles.columnHeading} numberOfLines={1}>Log: {branch || "全部分支"}</Text><TextInput value={searchText} onChangeText={setSearchText} placeholder="搜索提交说明" style={styles.search} /></View>
          <ScrollView style={styles.log}>
            {commits.map((item) => <Pressable key={item.hash} accessibilityRole="button" accessibilityLabel={`查看提交 ${item.subject}`} accessibilityState={{ selected: selectedHash === item.hash }} onPress={() => setSelectedHash(item.hash)} style={[styles.commitRow, selectedHash === item.hash && styles.selected]}>
              <View style={styles.graph}><View style={styles.graphLine} /><View style={[styles.graphDot, item.parents.length > 1 && styles.mergeDot]} /></View>
              <View style={styles.commitTextBlock}>
                <View style={styles.commitTitleRow}><Text style={styles.subject} numberOfLines={1}>{item.subject}</Text><Text style={styles.hash}>{item.hash.slice(0, 8)}</Text></View>
                <View style={styles.commitMeta}><Text style={styles.author} numberOfLines={1}>{item.author}</Text><Text style={styles.date}>{new Date(item.date).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>{item.refs[0] ? <Text style={styles.ref} numberOfLines={1}>{item.refs[0]}</Text> : null}</View>
              </View>
            </Pressable>)}
            {hasMore ? <Pressable accessibilityRole="button" onPress={() => { if (!loading) setSkip((value) => value + 50); }} style={styles.loadMore}><Text style={styles.loadMoreText}>{loading ? "加载中…" : "加载更多提交"}</Text></Pressable> : null}
            {!loading && commits.length === 0 ? <Text style={styles.empty}>没有找到提交记录</Text> : null}
          </ScrollView>
        </View>
        <View style={styles.detail}>
          {selectedCommit ? <>
            <View style={styles.filesSection}><Text style={styles.columnHeading}>变更文件 {detail?.files.length ?? ""}</Text><ScrollView style={styles.files}>{detail ? renderFiles(tree(detail.files), 0) : <Text style={styles.empty}>加载变更文件…</Text>}</ScrollView></View>
            <View style={styles.detailHeader}><Text style={styles.detailSubject} numberOfLines={2}>{selectedCommit.subject}</Text><Text style={styles.detailMeta}>{selectedCommit.hash.slice(0, 10)} · {selectedCommit.author} · {new Date(selectedCommit.date).toLocaleString("zh-CN")}</Text>{detail?.message && detail.message !== selectedCommit.subject ? <Text style={styles.detailMessage} numberOfLines={3}>{detail.message}</Text> : null}</View>
          </> : <Text style={styles.empty}>选择一条提交查看详情</Text>}
        </View>
      </View>
    </ScrollView>
    {error ? <Text style={styles.error} numberOfLines={2}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: "#fff" },
  toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 10, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  heading: { fontSize: 15, fontWeight: "600", color: "#111827" },
  horizontalViewport: { flexGrow: 0, minHeight: 0 },
  horizontalContent: { flexGrow: 1, alignItems: "stretch" },
  topRow: { flexDirection: "row", minHeight: 0, borderBottomWidth: 1, borderColor: "#d1d5db" },
  commitArea: { width: 260, minHeight: 0, overflow: "hidden", borderRightWidth: 1, borderColor: "#d1d5db" },
  topDiff: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" },
  bottomViewport: { borderTopWidth: 1, borderColor: "#d1d5db" },
  columns: { flexDirection: "row", minHeight: 0 },
  sidebar: { width: 230, minHeight: 0, borderRightWidth: 1, borderColor: "#e5e7eb" },
  sidebarScroll: { flex: 1, minHeight: 0 },
  columnHeading: { paddingHorizontal: 10, paddingVertical: 9, fontSize: 12, fontWeight: "600", color: "#374151", borderBottomWidth: 1, borderColor: "#e5e7eb" },
  branchGroup: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10 },
  branchGroupText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  branchCount: { marginLeft: "auto", fontSize: 11, color: "#9ca3af" },
  branchRow: { minHeight: 29, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 },
  branchIndent: { width: 14 },
  branchName: { flex: 1, fontSize: 12, color: "#374151" },
  activeBranch: { color: "#1641ad", fontWeight: "600" },
  currentMarker: { fontSize: 10, color: "#0f8b59" },
  logColumn: { flex: 1.25, minWidth: 0, minHeight: 0, borderRightWidth: 1, borderColor: "#e5e7eb" },
  logToolbar: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  search: { flex: 1, marginHorizontal: 8, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12 },
  log: { flex: 1, minHeight: 0 },
  commitRow: { flexDirection: "row", minHeight: 50, paddingRight: 8 },
  selected: { backgroundColor: "#e8f0ff" },
  graph: { width: 29, alignItems: "center", justifyContent: "center" },
  graphLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "#b19bd2" },
  graphDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#9754bd" },
  mergeDot: { backgroundColor: "#36aaa5" },
  commitTextBlock: { flex: 1, minWidth: 0, justifyContent: "center", gap: 3 },
  commitTitleRow: { flexDirection: "row", gap: 6 },
  subject: { flex: 1, fontSize: 12, color: "#111827", fontWeight: "600" },
  hash: { fontSize: 11, color: "#64748b" },
  commitMeta: { flexDirection: "row", gap: 7 },
  author: { fontSize: 11, color: "#64748b", maxWidth: 90 },
  date: { fontSize: 11, color: "#64748b" },
  ref: { flex: 1, fontSize: 11, color: "#0f8b59" },
  loadMore: { alignItems: "center", padding: 12 },
  loadMoreText: { color: "#1641ad", fontSize: 12 },
  detail: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  filesSection: { height: "58%", minHeight: 115, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  detailHeader: { flex: 1, minHeight: 0, padding: 10, gap: 4, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  detailSubject: { fontSize: 14, fontWeight: "600", color: "#111827" },
  detailMeta: { fontSize: 11, color: "#64748b" },
  detailMessage: { fontSize: 11, color: "#374151" },
  files: { flex: 1, minHeight: 0 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, paddingRight: 8 },
  fileIndent: { width: 14 },
  folderName: { fontSize: 12, color: "#374151", flexShrink: 1 },
  count: { fontSize: 10, color: "#9ca3af" },
  fileName: { fontSize: 12, flexShrink: 1 },
  added: { color: "#07833d" },
  modified: { color: "#1641ad" },
  deleted: { color: "#bc3145" },
  diffHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 38, paddingHorizontal: 9, position: "relative", zIndex: 3 },
  diffPath: { flex: 1, fontSize: 12, color: "#374151" },
  diffAction: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  empty: { padding: 12, fontSize: 12, color: "#6b7280" },
  error: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 9, paddingVertical: 5, color: "#b91c1c", backgroundColor: "#fff", fontSize: 11 },
});
