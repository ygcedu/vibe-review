import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { gitCommitDetailRpc, gitCommitFileDiffRpc, gitHistoryRpc } from "../shared/git-history";
import { workspaceGitDiffRpc } from "../shared/workspace-commit";
import { parseDiffFiles } from "./diff/diff";
import { FileTypeIcon } from "./diff/file-icons";
import { SplitDiff } from "./diff/split-diff";
import { WorkspaceCommitPanel } from "./workspace-commit";
import { DiffOptionButton, WrapToggleButton } from "./diff/wrap-toggle";
import { compactTree, sortTreeNodes } from "./diff/file-tree-utils";

type Commit = { hash: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string[] };
type ChangedFile = { path: string; status: string };
type DiffTab = { id: string; source: "working"; path: string; staged: boolean; status?: string } | { id: string; source: "history"; path: string; hash: string; status: string };
type TreeNode = { kind: "folder"; name: string; path: string; count: number; children: TreeNode[] } | { kind: "file"; name: string; file: ChangedFile };
type Branch = { name: string; group: "local" | "remote" | "tag"; ahead: number; behind: number };
type BranchNode = { kind: "folder"; name: string; path: string; children: BranchNode[] } | { kind: "branch"; name: string; fullName: string; ahead: number; behind: number };
const TAB_DRAG_TYPE = "application/x-vibe-review-diff-tab";
const SPLITTER_SIZE = 6;
const PANEL_PADDING = 8;
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

function ReorderableTab({ tab, active, onActivate, onClose, onReorder, onNode }: {
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
  return <View ref={ref} style={[styles.tab, hovered && !active && styles.hoveredTab, active && styles.activeTab]}>
    <Pressable accessibilityRole="tab" accessibilityLabel={`${tab.source === "working" ? "工作区" : "历史提交"} ${tab.path}`} accessibilityState={{ selected: active }} onPress={onActivate} style={styles.tabSelect}>
      <FileTypeIcon fileName={tab.path} />
      <Text style={[styles.tabTitle, fileColor(tab.status ?? "M")]} numberOfLines={1}>{tab.path.split("/").at(-1)}</Text>
      <Text style={styles.tabSource} numberOfLines={1}>{tab.source === "working" ? "工作区" : tab.hash.slice(0, 7)}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`关闭 ${tab.path} 标签`} onPress={onClose} onHoverIn={() => setCloseHovered(true)} onHoverOut={() => setCloseHovered(false)} style={[styles.tabClose, closeHovered && styles.tabCloseHovered]}><Icon name="X" size={13} color="#94a3b8" /></Pressable>
  </View>;
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
  sortTreeNodes(root);
  return compactTree(root);
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

export function GitHistoryPanel(props: PluginWorkspacePanelProps) {
  const { workspaceId } = props;
  const getHistory = useRpc(gitHistoryRpc);
  const getDetail = useRpc(gitCommitDetailRpc);
  const getFileDiff = useRpc(gitCommitFileDiffRpc);
  const getWorkingDiff = useRpc(workspaceGitDiffRpc);
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
  const [tabs, setTabs] = useState<DiffTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [tabViewportWidth, setTabViewportWidth] = useState(0);
  const [tabContentWidth, setTabContentWidth] = useState(0);
  const tabBarRef = useRef<ScrollView>(null);
  const tabNodes = useRef(new Map<string, HTMLElement>());
  const [diff, setDiff] = useState<{ tabId: string | null; text: string; loading: boolean }>({ tabId: null, text: "", loading: false });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [branchCollapsed, setBranchCollapsed] = useState<Set<string>>(new Set(["remote", "tag"]));
  const branchDefaultsWorkspace = useRef<string | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [panelWidth, setPanelWidth] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const [commitWidth, setCommitWidth] = useState(260);
  const [branchColumnWidth, setBranchColumnWidth] = useState<number | null>(null);
  const [logColumnWidth, setLogColumnWidth] = useState<number | null>(null);
  const [preferredTopHeight, setPreferredTopHeight] = useState<number | null>(null);
  const [historyMinimized, setHistoryMinimized] = useState(false);
  const [diffHeight, setDiffHeight] = useState(0);
  const [wrapLines, setWrapLines] = useState(false);
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);
  const [syncScrolling, setSyncScrolling] = useState(true);
  const [error, setError] = useState("");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tabOverflow = tabContentWidth > tabViewportWidth + 2;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

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
  }, []);

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

  useEffect(() => { setTabs([]); setActiveTabId(null); setTabMenuOpen(false); setDiff({ tabId: null, text: "", loading: false }); }, [workspaceId]);

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

  useEffect(() => {
    let active = true;
    setDiff({ tabId: activeTab?.id ?? null, text: "", loading: Boolean(activeTab) });
    if (activeTab) {
      const request = activeTab.source === "working"
        ? getWorkingDiff({ workspaceId, path: activeTab.path, staged: activeTab.staged })
        : getFileDiff({ workspaceId, hash: activeTab.hash, path: activeTab.path });
      void request.then(
        (value) => { if (active) setDiff({ tabId: activeTab.id, text: value.diff, loading: false }); },
        (reason: unknown) => { if (active) { setDiff({ tabId: activeTab.id, text: "", loading: false }); setError(String(reason)); } },
      );
    }
    return () => { active = false; };
  }, [workspaceId, activeTab?.id, activeTab?.source === "working" ? activeTab.staged : undefined]);

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
  const openTab = (tab: DiffTab) => {
    setTabs((current) => current.some((item) => item.id === tab.id)
      ? current.map((item) => item.id === tab.id ? tab : item)
      : [...current, tab]);
    setActiveTabId(tab.id);
  };
  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (activeTabId === id) setActiveTabId(next[Math.min(index, next.length - 1)]?.id ?? null);
  };
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
        <Text style={styles.count}>{node.count} 个文件</Text>
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
  const parsed = useMemo(() => parseDiffFiles(activeTab?.id === diff.tabId ? diff.text : ""), [activeTab?.id, diff.tabId, diff.text]);
  const loadFullDiff = async () => {
    if (!activeTab) return null;
    const result = activeTab.source === "working"
      ? await getWorkingDiff({ workspaceId, path: activeTab.path, staged: activeTab.staged, fullContext: true })
      : await getFileDiff({ workspaceId, hash: activeTab.hash, path: activeTab.path, fullContext: true });
    return parseDiffFiles(result.diff)[0] ?? null;
  };
  const diffLoading = Boolean(activeTab && (activeTab.id !== diff.tabId || diff.loading));
  const contentHeight = Math.max(0, panelHeight - PANEL_PADDING * 2);
  const contentWidth = Math.max(0, panelWidth - PANEL_PADDING * 2);
  const availableHeight = Math.max(0, contentHeight - SPLITTER_SIZE);
  const minimumTop = Math.min(160, Math.max(0, availableHeight - 36));
  const minimumBottom = Math.min(160, Math.max(36, availableHeight - minimumTop));
  const defaultTopHeight = Math.round(availableHeight * 0.53);
  const topHeight = historyMinimized ? Math.max(0, availableHeight - 36) : Math.max(minimumTop, Math.min(availableHeight - minimumBottom, preferredTopHeight ?? defaultTopHeight));
  const bottomHeight = Math.max(0, availableHeight - topHeight);
  const minimumCommitWidth = Math.min(180, Math.max(0, contentWidth * 0.25));
  const minimumDiffWidth = Math.min(240, Math.max(0, contentWidth * 0.35));
  const maximumCommitWidth = Math.max(minimumCommitWidth, contentWidth - SPLITTER_SIZE - minimumDiffWidth);
  const resolvedCommitWidth = Math.max(minimumCommitWidth, Math.min(maximumCommitWidth, commitWidth));
  const columnSpace = Math.max(0, contentWidth - SPLITTER_SIZE * 2);
  const minimumBranchWidth = Math.min(160, columnSpace * 0.25);
  const minimumLogWidth = Math.min(250, columnSpace * 0.35);
  const minimumDetailWidth = Math.min(200, columnSpace * 0.2);
  const defaultBranchColumnWidth = resolvedCommitWidth;
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
    <View style={[styles.topRow, { height: topHeight }]}>
        <View style={[styles.commitArea, { width: resolvedCommitWidth }]}><WorkspaceCommitPanel {...props} externalPreview={activeTab?.source === "working" ? activeTab : null} onFilePreview={(selection) => openTab({ id: `working:${selection.path}`, source: "working", ...selection })} /></View>
        <ResizeHandle direction="vertical" appearance="gutter" label="调整提交更改面板宽度" onResize={(delta) => setCommitWidth((width) => Math.max(minimumCommitWidth, Math.min(maximumCommitWidth, Math.max(minimumCommitWidth, Math.min(maximumCommitWidth, width)) + delta)))} />
        <View style={styles.topDiff} onLayout={(event) => setDiffHeight(event.nativeEvent.layout.height)}>
          <View style={styles.tabStrip}>
            <ScrollView ref={tabBarRef} horizontal style={styles.tabBar} contentContainerStyle={styles.tabBarContent} showsHorizontalScrollIndicator={false} onLayout={(event) => setTabViewportWidth(event.nativeEvent.layout.width)} onContentSizeChange={(width) => setTabContentWidth(width)}>
              {tabs.length ? tabs.map((tab) => <ReorderableTab key={tab.id} tab={tab} active={activeTabId === tab.id} onActivate={() => setActiveTabId(tab.id)} onClose={() => closeTab(tab.id)} onReorder={reorderTab} onNode={registerTabNode} />) : <Text style={styles.emptyTab}>Diff 预览</Text>}
            </ScrollView>
            {tabOverflow && tabs.length ? <Pressable accessibilityRole="button" accessibilityLabel="显示所有打开的文件" accessibilityState={{ expanded: tabMenuOpen }} onPress={() => setTabMenuOpen((value) => !value)} style={[styles.tabMenuButton, tabMenuOpen && styles.tabMenuButtonActive]}><Icon name="ChevronDown" size={16} color="#64748b" /></Pressable> : null}
            {tabMenuOpen && tabOverflow ? <ScrollView style={[styles.tabMenu, { maxHeight: Math.min(360, Math.max(100, diffHeight - 45)) }]} nestedScrollEnabled>
              {tabs.map((tab) => <View key={tab.id} style={[styles.tabMenuRow, activeTabId === tab.id && styles.tabMenuRowActive]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`切换到 ${tab.path}`} onPress={() => { setActiveTabId(tab.id); setTabMenuOpen(false); }} style={styles.tabMenuSelect}>
                  <FileTypeIcon fileName={tab.path} />
                  <Text style={[styles.tabMenuTitle, fileColor(tab.status ?? "M")]} numberOfLines={1}>{tab.path.split("/").at(-1)}</Text>
                  <Text style={styles.tabSource}>{tab.source === "working" ? "工作区" : tab.hash.slice(0, 7)}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`关闭 ${tab.path} 标签`} onPress={() => closeTab(tab.id)} style={styles.tabMenuClose}><Icon name="X" size={14} color="#94a3b8" /></Pressable>
              </View>)}
            </ScrollView> : null}
          </View>
          <View style={styles.diffHeader}>
            <Text style={styles.diffPath} numberOfLines={1}>{activeTab ? `${activeTab.source === "working" ? "Working Diff" : "Repository Diff"}: ${activeTab.path}` : "选择文件查看差异"}</Text>
            {activeTab ? <>
              <View style={styles.diffActions}><DiffOptionButton active={collapseUnchanged} onToggle={() => setCollapseUnchanged((value) => !value)} label="折叠未变更代码" icon="ChevronsDownUp" /><DiffOptionButton active={syncScrolling} onToggle={() => setSyncScrolling((value) => !value)} label="左右同步滚动" icon="ArrowDownUp" /><WrapToggleButton active={wrapLines} onToggle={() => setWrapLines((value) => !value)} /></View>
            </> : null}
          </View>
          {activeTab && parsed[0] && diffHeight > 75 ? <SplitDiff key={activeTab.id} file={parsed[0]} wrapLines={wrapLines} collapseUnchanged={collapseUnchanged} syncScrolling={syncScrolling} loadFullFile={loadFullDiff} maxHeight={Math.max(32, diffHeight - 75)} /> : <Text style={styles.empty}>{diffLoading ? "加载差异…" : activeTab ? "没有可显示的文本差异" : "点击左侧或下方变更文件，在这里查看 Diff"}</Text>}
        </View>
    </View>
    <ResizeHandle direction="horizontal" appearance="gutter" label="调整 Git 历史面板高度" onResize={(delta) => { setPreferredTopHeight((height) => Math.max(minimumTop, Math.min(availableHeight - minimumBottom, (historyMinimized ? availableHeight - 36 : height ?? defaultTopHeight) + delta))); setHistoryMinimized(false); }} />
    <View style={[styles.bottomPanel, { height: bottomHeight }]}>
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle} numberOfLines={1}>Log: {branch || "全部分支"}</Text>
        <View style={styles.historyActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="刷新提交历史" onPress={() => { setSkip(0); setRevision((value) => value + 1); }} style={styles.historyMinimize}><Icon name="RefreshCw" size={15} color="#64748b" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={historyMinimized ? "展开 Git 历史面板" : "最小化 Git 历史面板"} onPress={() => setHistoryMinimized((value) => !value)} style={styles.historyMinimize}><Icon name={historyMinimized ? "Maximize2" : "Minus"} size={15} color="#64748b" /></Pressable>
        </View>
      </View>
      {!historyMinimized ? <View style={styles.bottomViewport}>
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
            <View style={[styles.filesSection, { height: filesHeight }]}><Text style={styles.columnHeading}>变更文件 {detail?.files.length ?? ""}</Text><ScrollView style={styles.files}>{detail ? renderFiles(tree(detail.files), 0) : <Text style={styles.empty}>加载变更文件…</Text>}</ScrollView></View>
            <ResizeHandle direction="horizontal" appearance="line" label="调整变更文件与提交说明的高度" onResize={(delta) => setPreferredFilesHeight((height) => Math.max(minimumFilesHeight, Math.min(maximumFilesHeight, Math.max(minimumFilesHeight, Math.min(maximumFilesHeight, height ?? filesHeight)) + delta)))} />
            <ScrollView key={selectedCommit.hash} style={styles.detailMessageScroll} contentContainerStyle={styles.detailMessageContent}>
              <CommitMessageText value={detail?.message ?? selectedCommit.subject} />
              <Text style={styles.detailMeta}>{selectedCommit.hash.slice(0, 8)}  {selectedCommit.author} &lt;{selectedCommit.email}&gt; on {new Date(selectedCommit.date).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</Text>
              {detail?.containingBranches.length ? <Text style={styles.detailMeta}>In {detail.containingBranches.length} branches: {detail.containingBranches.join(", ")}</Text> : null}
            </ScrollView>
          </> : <Text style={styles.empty}>选择一条提交查看详情</Text>}
        </View>
      </View>
    </View> : null}
      {!historyMinimized ? <View style={styles.historyFooter}><Icon name="GitBranch" size={13} color="#64748b" /><Text style={styles.historyBranch} numberOfLines={1}>{currentBranch || "未检测到分支"}</Text></View> : null}
    </View>
    {error ? <Text style={styles.error} numberOfLines={2}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", padding: PANEL_PADDING, backgroundColor: "#eef0f3" },
  topRow: { flexDirection: "row", minWidth: 0, minHeight: 0, overflow: "hidden" },
  commitArea: { minHeight: 0, overflow: "hidden", backgroundColor: "#fff", borderRadius: 8 },
  verticalGutter: { width: SPLITTER_SIZE, backgroundColor: "#eef0f3" },
  horizontalGutter: { height: SPLITTER_SIZE, backgroundColor: "#eef0f3" },
  verticalLineSplitter: { width: SPLITTER_SIZE, alignItems: "center" },
  splitterLine: { width: 1, height: "100%", backgroundColor: "#d1d5db" },
  horizontalLineSplitter: { height: SPLITTER_SIZE, justifyContent: "center" },
  splitterLineHorizontal: { height: 1, width: "100%", backgroundColor: "#d1d5db" },
  topDiff: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", backgroundColor: "#fff", borderRadius: 8 },
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
  bottomPanel: { minHeight: 0, overflow: "hidden", backgroundColor: "#fff", borderTopLeftRadius: 8, borderTopRightRadius: 8 },
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
  diffHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 38, paddingHorizontal: 9, position: "relative", zIndex: 20 },
  diffActions: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 0 },
  diffPath: { flex: 1, fontSize: 12, color: "#374151" },
  empty: { padding: 12, fontSize: 12, color: "#6b7280" },
  error: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 9, paddingVertical: 5, color: "#b91c1c", backgroundColor: "#fff", fontSize: 11 },
});
