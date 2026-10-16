import { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { gitCommitDetailRpc, gitHistoryRpc } from "../shared/git-history";
import { FileTypeIcon } from "./diff/file-icons";
import { useGitDiffState, type DiffTab } from "./git-diff-state";
import { buildFileTree, sortTreeNodes, type FileTreeNode } from "./diff/file-tree-utils";

type Commit = { hash: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string[] };
type ChangedFile = { path: string; status: string };
type TreeNode = FileTreeNode<ChangedFile>;
type Branch = { name: string; group: "local" | "remote" | "tag"; ahead: number; behind: number };
type BranchNode = { kind: "folder"; name: string; path: string; children: BranchNode[] } | { kind: "branch"; name: string; fullName: string; ahead: number; behind: number };
const SPLITTER_SIZE = 6;
const CURRENT_BRANCH_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f5a400" d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.828 8.828a2 2 0 0 0 2.828 0l7.172-7.172a2 2 0 0 0 0-2.828z"/><circle cx="7.5" cy="7.5" r="1.7" fill="white"/></svg>')}`;

function CommitHash({ value }: { value: string }) {
  const ref = useRef<Text>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    node?.setAttribute("data-pmono", "");
    return () => { node?.removeAttribute("data-pmono"); };
  }, []);
  return <Text ref={ref} style={styles.hash} numberOfLines={1}>{value.slice(0, 8)}</Text>;
}

function CommitDate({ value }: { value: string }) {
  const ref = useRef<Text>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    node?.setAttribute("data-pmono", "");
    return () => { node?.removeAttribute("data-pmono"); };
  }, []);
  return <Text ref={ref} style={styles.date} numberOfLines={1}>{value}</Text>;
}

function CommitMessageText({ value }: { value: string }) {
  const ref = useRef<Text>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    node?.setAttribute("data-pmono", "");
    return () => { node?.removeAttribute("data-pmono"); };
  }, []);
  return <Text ref={ref} style={styles.detailMessage}>{value}</Text>;
}

function ResizeHandle({ direction, appearance, label, onResize }: { direction: "horizontal" | "vertical"; appearance: "gutter" | "line"; label: string; onResize: (delta: number) => void }) {
  const ref = useRef<View>(null);
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    node.style.cursor = direction === "vertical" ? "col-resize" : "row-resize";
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      let previous = direction === "vertical" ? event.clientX : event.clientY;
      const oldCursor = document.body.style.cursor;
      const oldSelection = document.body.style.userSelect;
      document.body.style.cursor = direction === "vertical" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      const move = (next: PointerEvent) => {
        const position = direction === "vertical" ? next.clientX : next.clientY;
        resizeRef.current(position - previous);
        previous = position;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = oldCursor;
        document.body.style.userSelect = oldSelection;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    };
    node.addEventListener("pointerdown", down);
    return () => node.removeEventListener("pointerdown", down);
  }, [direction]);
  return <View ref={ref} accessibilityRole="adjustable" accessibilityLabel={label} style={direction === "vertical" ? appearance === "line" ? styles.verticalLineSplitter : styles.verticalGutter : appearance === "line" ? styles.horizontalLineSplitter : styles.horizontalGutter}>{appearance === "line" ? <View style={direction === "vertical" ? styles.splitterLine : styles.splitterLineHorizontal} /> : null}</View>;
}

function branchTree(branches: Branch[], group: Branch["group"]): BranchNode[] {
  const root: BranchNode[] = [];
  const folders = new Map<string, Extract<BranchNode, { kind: "folder" }>>();
  for (const branch of branches.filter((item) => item.group === group)) {
    const displayName = group === "tag" && branch.name.startsWith("tags/") ? branch.name.slice(5) : branch.name;
    const parts = displayName.split("/");
    let children = root;
    let path = group;
    for (const name of parts.slice(0, -1)) {
      path += `/${name}`;
      let folder = folders.get(path);
      if (!folder) { folder = { kind: "folder", name, path, children: [] }; folders.set(path, folder); children.push(folder); }
      children = folder.children;
    }
    children.push({ kind: "branch", name: parts.at(-1) ?? displayName, fullName: branch.name, ahead: branch.ahead, behind: branch.behind });
  }
  sortTreeNodes(root);
  return root;
}

function fileColor(status: string) {
  if (status.includes("D") || status.includes("?")) return styles.deleted;
  if (status.includes("A")) return styles.added;
  return styles.modified;
}

function formatCommitTime(value: string, nowMs: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const elapsed = nowMs - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return "Moments ago";
  if (elapsed >= 0 && elapsed < 60 * 60_000) {
    const minutes = Math.floor(elapsed / 60_000);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.getTime() >= today && date.getTime() <= nowMs) return `Today ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (date.getTime() >= yesterday && date.getTime() < today) return `Yesterday ${time}`;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${time}`;
}

export function GitHistoryPanel(props: PluginWorkspacePanelProps & { onOpenDiff(): void }) {
  const { workspaceId } = props;
  const getHistory = useRpc(gitHistoryRpc);
  const getDetail = useRpc(gitCommitDetailRpc);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [currentGitUser, setCurrentGitUser] = useState({ name: "", email: "" });
  const [nowMs, setNowMs] = useState(Date.now());
  const [branch, setBranch] = useState("");
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ message: string; files: ChangedFile[]; containingBranches: string[] } | null>(null);
  const [detailPanelHeight, setDetailPanelHeight] = useState(0);
  const [preferredFilesHeight, setPreferredFilesHeight] = useState<number | null>(null);
  const { activeTabId, openTab: selectTab } = useGitDiffState(workspaceId);
  const openTab = (tab: DiffTab) => { selectTab(tab); props.onOpenDiff(); };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [branchCollapsed, setBranchCollapsed] = useState<Set<string>>(new Set(["remote", "tag"]));
  const branchDefaultsWorkspace = useRef<string | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [panelWidth, setPanelWidth] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const [branchColumnWidth, setBranchColumnWidth] = useState<number | null>(null);
  const [logColumnWidth, setLogColumnWidth] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

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
      if (branchDefaultsWorkspace.current !== workspaceId) {
        const initiallyCollapsed = new Set(["remote", "tag"]);
        for (const item of value.branches) {
          if (item.group !== "local") continue;
          const parts = item.name.split("/");
          for (let depth = 1; depth < parts.length; depth++) {
            const folder = parts.slice(0, depth).join("/");
            if (!value.currentBranch.startsWith(`${folder}/`)) initiallyCollapsed.add(`local/${folder}`);
          }
        }
        setBranchCollapsed(initiallyCollapsed);
        branchDefaultsWorkspace.current = workspaceId;
      }
      setCurrentGitUser(value.currentGitUser);
      setHasMore(value.hasMore);
      if (skip === 0) setSelectedHash(value.commits[0]?.hash ?? null);
      setError("");
    }, (reason: unknown) => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, branch, query, skip, revision]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selectedHash) void getDetail({ workspaceId, hash: selectedHash }).then((value) => {
      if (!active) return;
      setDetail(value);
      setCollapsed(new Set());
    }, (reason: unknown) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [workspaceId, selectedHash]);

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
  const renderBranches = (nodes: BranchNode[], group: Branch["group"]): React.ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") return <View key={node.path}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${branchCollapsed.has(node.path) ? "展开" : "折叠"} ${node.name}`} onPress={() => toggleBranchFolder(node.path)} style={styles.branchRow}>
        <Icon name={branchCollapsed.has(node.path) ? "ChevronRight" : "ChevronDown"} size={14} color="#64748b" />
        <Icon name="Folder" size={15} color="#64748b" />
        <Text style={styles.branchName} numberOfLines={1}>{node.name}</Text>
      </Pressable>
      {!branchCollapsed.has(node.path) || branchSearch.trim() ? <View style={styles.branchChildren}>{renderBranches(node.children, group)}</View> : null}
    </View>;
    const isCurrent = group === "local" && node.fullName === currentBranch;
    const isMain = (group === "local" && (node.fullName === "main" || node.fullName === "master")) || (group === "remote" && (node.fullName === "origin/main" || node.fullName === "origin/master"));
    return <Pressable key={`${group}/${node.fullName}`} accessibilityRole="button" accessibilityLabel={`查看${group === "tag" ? "标签" : "分支"} ${node.fullName}`} accessibilityState={{ selected: branch === node.fullName }} onPress={() => chooseBranch(node.fullName)} style={[styles.branchRow, branch === node.fullName && styles.branchSelected]}>
      <View style={styles.branchIndent} />
      <View style={styles.branchIcon}>{isCurrent && isMain ? <Image source={{ uri: CURRENT_BRANCH_ICON }} style={styles.currentBranchIcon} /> : isMain ? <Text style={styles.mainBranchIcon}>★</Text> : <Icon name={group === "tag" || isCurrent ? "Tag" : "GitBranch"} size={16} color={isCurrent ? "#f5a400" : "#64748b"} />}</View>
      <Text style={[styles.branchLeafName, branch === node.fullName && styles.activeBranch]} numberOfLines={1}>{node.name}</Text>
      {group === "local" && (node.ahead > 0 || node.behind > 0) ? <View style={styles.branchTracking}>{node.behind > 0 ? <><Icon name="ArrowDownLeft" size={14} color="#3478f6" /><Text style={styles.behindCount}>{node.behind}</Text></> : null}{node.ahead > 0 ? <><Icon name="ArrowUpRight" size={14} color="#30a653" /><Text style={styles.aheadCount}>{node.ahead}</Text></> : null}</View> : null}
    </Pressable>;
  });
  const renderFiles = (nodes: TreeNode[], depth: number): React.ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") return <View key={node.path}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${collapsed.has(node.path) ? "展开" : "折叠"} ${node.path}`} onPress={() => toggleFolder(node.path)} style={[styles.fileRow, { paddingLeft: 8 + depth * 18 }]}>
        <Icon name={collapsed.has(node.path) ? "ChevronRight" : "ChevronDown"} size={14} color="#64748b" />
        <Icon name="Folder" size={16} color="#64748b" />
        <Text style={styles.folderName} numberOfLines={1}>{node.name}</Text>
        <Text style={styles.count}>{node.files.length} 个文件</Text>
      </Pressable>
      {!collapsed.has(node.path) ? renderFiles(node.children, depth + 1) : null}
    </View>;
    const tabId = `history:${selectedHash}:${node.file.path}`;
    return <Pressable key={node.file.path} accessibilityRole="button" accessibilityLabel={`查看 ${node.file.path} 的提交差异`} onPress={() => { if (selectedHash) openTab({ id: tabId, source: "history", hash: selectedHash, path: node.file.path, status: node.file.status }); }} style={[styles.fileRow, { paddingLeft: 8 + depth * 18 }, activeTabId === tabId && styles.selected]}>
      <View style={styles.fileIndent} />
      <FileTypeIcon fileName={node.name} />
      <Text style={[styles.fileName, fileColor(node.file.status)]} numberOfLines={1}>{node.name}</Text>
    </Pressable>;
  });
  const selectedCommit = commits.find((item) => item.hash === selectedHash);
  const contentWidth = Math.max(0, panelWidth);
  const bottomHeight = panelHeight;
  const columnSpace = Math.max(0, contentWidth - SPLITTER_SIZE * 2);
  const minimumBranchWidth = Math.min(160, columnSpace * 0.25);
  const minimumLogWidth = Math.min(250, columnSpace * 0.35);
  const minimumDetailWidth = Math.min(200, columnSpace * 0.2);
  const defaultBranchColumnWidth = Math.min(260, contentWidth * 0.2);
  const maximumBranchWidth = Math.max(minimumBranchWidth, columnSpace - minimumLogWidth - minimumDetailWidth);
  const resolvedBranchColumnWidth = Math.max(minimumBranchWidth, Math.min(maximumBranchWidth, branchColumnWidth ?? defaultBranchColumnWidth));
  const defaultLogColumnWidth = Math.round((columnSpace - resolvedBranchColumnWidth) * 0.68);
  const maximumLogWidth = Math.max(minimumLogWidth, columnSpace - resolvedBranchColumnWidth - minimumDetailWidth);
  const resolvedLogColumnWidth = Math.max(minimumLogWidth, Math.min(maximumLogWidth, logColumnWidth ?? defaultLogColumnWidth));
  const minimumFilesHeight = Math.min(100, Math.max(0, detailPanelHeight - SPLITTER_SIZE));
  const minimumMessageHeight = Math.min(100, Math.max(0, detailPanelHeight - SPLITTER_SIZE - minimumFilesHeight));
  const maximumFilesHeight = Math.max(minimumFilesHeight, detailPanelHeight - SPLITTER_SIZE - minimumMessageHeight);
  const filesHeight = Math.max(minimumFilesHeight, Math.min(maximumFilesHeight, preferredFilesHeight ?? detailPanelHeight * 0.58));

  return <View style={styles.root} onLayout={(event) => { setPanelWidth(event.nativeEvent.layout.width); setPanelHeight(event.nativeEvent.layout.height); }}>
    <View style={[styles.bottomPanel, { height: bottomHeight }]}>
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle} numberOfLines={1}>Log: {branch || "全部分支"}</Text>
        <View style={styles.historyActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="刷新提交历史" onPress={() => { setSkip(0); setRevision((value) => value + 1); }} style={styles.historyMinimize}><Icon name="RefreshCw" size={15} color="#64748b" /></Pressable>
        </View>
      </View>
      <View style={styles.bottomViewport}>
      <View style={[styles.columns, { height: Math.max(0, bottomHeight - 58) }]}>
        <View style={[styles.sidebar, { width: resolvedBranchColumnWidth }]}>
          <View style={styles.branchSearchRow}><Icon name="Search" size={16} color="#64748b" /><TextInput value={branchSearch} onChangeText={setBranchSearch} placeholder="Branch or tag" style={styles.branchSearchInput} /></View>
          <ScrollView style={styles.sidebarScroll}>
            {(["local", "remote", "tag"] as const).map((group) => {
              const query = branchSearch.trim().toLowerCase();
              const matching = branches.filter((item) => item.group === group && (!query || item.name.toLowerCase().includes(query)));
              if (!matching.length) return null;
              const label = group === "local" ? "Local" : group === "remote" ? "Remote" : "Tags";
              return <View key={group}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${branchCollapsed.has(group) ? "展开" : "折叠"}${label}`} onPress={() => toggleBranchFolder(group)} style={styles.branchGroup}><Icon name={branchCollapsed.has(group) ? "ChevronRight" : "ChevronDown"} size={14} color="#64748b" /><Text style={styles.branchGroupText}>{label}</Text></Pressable>
                {!branchCollapsed.has(group) || query ? <View style={styles.branchChildren}>{renderBranches(branchTree(matching, group), group)}</View> : null}
              </View>;
            })}
          </ScrollView>
        </View>
        <ResizeHandle direction="vertical" appearance="line" label="调整分支列表宽度" onResize={(delta) => setBranchColumnWidth((width) => Math.max(minimumBranchWidth, Math.min(maximumBranchWidth, Math.max(minimumBranchWidth, Math.min(maximumBranchWidth, width ?? resolvedBranchColumnWidth)) + delta)))} />
        <View style={[styles.logColumn, { width: resolvedLogColumnWidth }]}>
          <View style={styles.logToolbar}><TextInput value={searchText} onChangeText={setSearchText} placeholder="搜索提交说明" style={styles.search} /></View>
          <ScrollView style={styles.log}>
            {commits.map((item) => {
              const ownCommit = Boolean((currentGitUser.email && item.email.toLowerCase() === currentGitUser.email.toLowerCase()) || (!currentGitUser.email && currentGitUser.name && item.author === currentGitUser.name));
              return <Pressable key={item.hash} accessibilityRole="button" accessibilityLabel={`查看提交 ${item.subject}`} accessibilityState={{ selected: selectedHash === item.hash }} onPress={() => setSelectedHash(item.hash)} style={[styles.commitRow, selectedHash === item.hash && styles.selected]}>
                <Text style={[styles.author, ownCommit && styles.currentAuthor]} numberOfLines={1}>{item.author}</Text>
                <View style={styles.graph}><View style={styles.graphLine} /><View style={[styles.graphDot, item.parents.length > 1 && styles.mergeDot]} /></View>
                <Text style={styles.subject} numberOfLines={1}>{item.subject}{item.refs[0] ? <Text style={styles.ref}>  {item.refs[0]}</Text> : null}</Text>
                <CommitDate value={formatCommitTime(item.date, nowMs)} />
                <CommitHash value={item.hash} />
              </Pressable>;
            })}
            {hasMore ? <Pressable accessibilityRole="button" onPress={() => { if (!loading) setSkip((value) => value + 50); }} style={styles.loadMore}><Text style={styles.loadMoreText}>{loading ? "加载中…" : "加载更多提交"}</Text></Pressable> : null}
            {!loading && commits.length === 0 ? <Text style={styles.empty}>没有找到提交记录</Text> : null}
          </ScrollView>
        </View>
        <ResizeHandle direction="vertical" appearance="line" label="调整提交列表宽度" onResize={(delta) => setLogColumnWidth((width) => Math.max(minimumLogWidth, Math.min(maximumLogWidth, Math.max(minimumLogWidth, Math.min(maximumLogWidth, width ?? resolvedLogColumnWidth)) + delta)))} />
        <View style={styles.detail} onLayout={(event) => setDetailPanelHeight(event.nativeEvent.layout.height)}>
          {selectedCommit ? <>
            <View style={[styles.filesSection, { height: filesHeight }]}><Text style={styles.columnHeading}>变更文件 {detail?.files.length ?? ""}</Text><ScrollView style={styles.files}>{detail ? renderFiles(buildFileTree(detail.files, true), 0) : <Text style={styles.empty}>加载变更文件…</Text>}</ScrollView></View>
            <ResizeHandle direction="horizontal" appearance="line" label="调整变更文件与提交说明的高度" onResize={(delta) => setPreferredFilesHeight((height) => Math.max(minimumFilesHeight, Math.min(maximumFilesHeight, Math.max(minimumFilesHeight, Math.min(maximumFilesHeight, height ?? filesHeight)) + delta)))} />
            <ScrollView key={selectedCommit.hash} style={styles.detailMessageScroll} contentContainerStyle={styles.detailMessageContent}>
              <CommitMessageText value={detail?.message ?? selectedCommit.subject} />
              <Text style={styles.detailMeta}>{selectedCommit.hash.slice(0, 8)}  {selectedCommit.author} &lt;{selectedCommit.email}&gt; on {new Date(selectedCommit.date).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</Text>
              {detail?.containingBranches.length ? <Text style={styles.detailMeta}>In {detail.containingBranches.length} branches: {detail.containingBranches.join(", ")}</Text> : null}
            </ScrollView>
          </> : <Text style={styles.empty}>选择一条提交查看详情</Text>}
        </View>
      </View>
    </View>
      <View style={styles.historyFooter}><Icon name="GitBranch" size={13} color="#64748b" /><Text style={styles.historyBranch} numberOfLines={1}>{currentBranch || "未检测到分支"}</Text></View>
    </View>
    {error ? <Text style={styles.error} numberOfLines={2}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: "#fff" },
  verticalGutter: { width: SPLITTER_SIZE, backgroundColor: "#eef0f3" },
  horizontalGutter: { height: SPLITTER_SIZE, backgroundColor: "#eef0f3" },
  verticalLineSplitter: { width: SPLITTER_SIZE, alignItems: "center" },
  splitterLine: { width: 1, height: "100%", backgroundColor: "#d1d5db" },
  horizontalLineSplitter: { height: SPLITTER_SIZE, justifyContent: "center" },
  splitterLineHorizontal: { height: 1, width: "100%", backgroundColor: "#d1d5db" },
  bottomPanel: { minHeight: 0, overflow: "hidden", backgroundColor: "#fff" },
  historyHeader: { height: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 10, paddingRight: 7, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  historyTitle: { flex: 1, fontSize: 12, fontWeight: "600", color: "#374151" },
  historyActions: { flexDirection: "row", alignItems: "center", gap: 3 },
  historyMinimize: { width: 25, height: 25, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  bottomViewport: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  historyFooter: { height: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, paddingHorizontal: 10, borderTopWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#f8fafc" },
  historyBranch: { fontSize: 11, color: "#64748b" },
  columns: { flexDirection: "row", minWidth: 0, minHeight: 0 },
  sidebar: { minHeight: 0 },
  sidebarScroll: { flex: 1, minHeight: 0 },
  branchSearchRow: { height: 38, flexDirection: "row", alignItems: "center", gap: 7, margin: 5, paddingHorizontal: 9, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 5 },
  branchSearchInput: { flex: 1, minWidth: 0, fontSize: 12, color: "#111827" },
  columnHeading: { paddingHorizontal: 10, paddingVertical: 9, fontSize: 12, fontWeight: "600", color: "#374151", borderBottomWidth: 1, borderColor: "#e5e7eb" },
  branchGroup: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10 },
  branchGroupText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  branchChildren: { marginLeft: 17, borderLeftWidth: 1, borderLeftColor: "#e2e8f0" },
  branchRow: { minHeight: 29, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  branchSelected: { backgroundColor: "#d7e4ff", borderRadius: 5, marginHorizontal: 4, paddingHorizontal: 4 },
  branchIndent: { width: 14 },
  branchIcon: { width: 18, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  branchName: { flex: 1, fontSize: 12, color: "#374151" },
  branchLeafName: { minWidth: 0, flexShrink: 1, fontSize: 12, color: "#374151" },
  branchTracking: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 8, flexShrink: 0 },
  aheadCount: { fontSize: 11, color: "#30a653" },
  behindCount: { fontSize: 11, color: "#3478f6" },
  activeBranch: { color: "#1641ad", fontWeight: "600" },
  mainBranchIcon: { width: 14, fontSize: 18, lineHeight: 20, color: "#f5a400", textAlign: "center" },
  currentBranchIcon: { width: 16, height: 16 },
  logColumn: { minWidth: 0, minHeight: 0 },
  logToolbar: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  search: { flex: 1, marginHorizontal: 8, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12 },
  log: { flex: 1, minHeight: 0 },
  commitRow: { flexDirection: "row", alignItems: "center", minHeight: 36, paddingHorizontal: 8, gap: 5 },
  selected: { backgroundColor: "#e8f0ff" },
  graph: { width: 24, height: 36, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  graphLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "#b19bd2" },
  graphDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#9754bd" },
  mergeDot: { backgroundColor: "#36aaa5" },
  subject: { flex: 1, minWidth: 0, fontSize: 12, color: "#111827", fontWeight: "600" },
  hash: { width: 56, flexShrink: 0, textAlign: "left", fontFamily: "monospace", fontSize: 11, color: "#64748b" },
  author: { width: 80, minWidth: 40, flexShrink: 1, fontSize: 11, color: "#374151" },
  currentAuthor: { fontWeight: "700", color: "#111827" },
  date: { width: 121, minWidth: 0, flexShrink: 1, textAlign: "left", fontFamily: "monospace", fontSize: 11, color: "#64748b" },
  ref: { fontSize: 11, fontWeight: "400", color: "#0f8b59" },
  loadMore: { alignItems: "center", padding: 12 },
  loadMoreText: { color: "#1641ad", fontSize: 12 },
  detail: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  filesSection: { minHeight: 0 },
  detailMessageScroll: { flex: 1, minHeight: 0 },
  detailMessageContent: { padding: 10, gap: 14 },
  detailMeta: { fontSize: 11, color: "#64748b" },
  detailMessage: { fontFamily: "monospace", fontSize: 13, lineHeight: 19, color: "#111827" },
  files: { flex: 1, minHeight: 0 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, paddingRight: 8 },
  fileIndent: { width: 14 },
  folderName: { fontSize: 12, color: "#374151", flexShrink: 1 },
  count: { fontSize: 10, color: "#9ca3af" },
  fileName: { fontSize: 12, flexShrink: 1 },
  added: { color: "#07833d" },
  modified: { color: "#1641ad" },
  deleted: { color: "#bc3145" },
  empty: { padding: 12, fontSize: 12, color: "#6b7280" },
  error: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 9, paddingVertical: 5, color: "#b91c1c", backgroundColor: "#fff", fontSize: 11 },
});
