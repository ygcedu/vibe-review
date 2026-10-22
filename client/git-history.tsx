import { useHistoryActions } from "./history-actions";
import { ToolbarButton } from "./components/toolbar-button";
import { ContextMenu } from "./components/context-menu";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { gitCommitDetailRpc, gitHistoryRpc, type GitCommit as Commit, type GitBranch as Branch, type ChangedFile } from "../shared/git-history";
import { FileTypeIcon } from "./diff/file-icons";
import { useGitDiffState, type DiffTab } from "./git-diff-state";
import { buildFileTree, sortTreeNodes, type FileTreeNode } from "./diff/file-tree-utils";

type TreeNode = FileTreeNode<ChangedFile>;
type BranchNode = { kind: "folder"; name: string; path: string; children: BranchNode[] } | { kind: "branch"; name: string; fullName: string; ahead: number; behind: number };
const SPLITTER_SIZE = 6;
const CURRENT_BRANCH_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f5a400" d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.828 8.828a2 2 0 0 0 2.828 0l7.172-7.172a2 2 0 0 0 0-2.828z"/><circle cx="7.5" cy="7.5" r="1.7" fill="white"/></svg>')}`;

function borderOnlyFocus(input: TextInput | null) {
  if (Platform.OS !== "web" || !input) return;
  (input as unknown as HTMLElement).style.setProperty("outline", "none", "important");
}

function ResizeHandle({ direction, label, onResize, color }: { color: string; direction: "horizontal" | "vertical"; label: string; onResize: (delta: number) => void }) {
  const ref = useRef<View>(null);
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    node.style.cursor = direction === "vertical" ? "col-resize" : "row-resize";
    let stopDragging: (() => void) | undefined;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      stopDragging?.();
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
        window.removeEventListener("pointercancel", up);
        stopDragging = undefined;
        document.body.style.cursor = oldCursor;
        document.body.style.userSelect = oldSelection;
      };
      stopDragging = up;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
      window.addEventListener("pointercancel", up, { once: true });
    };
    node.addEventListener("pointerdown", down);
    return () => {
      node.removeEventListener("pointerdown", down);
      stopDragging?.();
    };
  }, [direction]);
  return <View ref={ref} accessibilityRole="adjustable" accessibilityLabel={label} style={direction === "vertical" ? baseStyles.verticalLineSplitter : baseStyles.horizontalLineSplitter}>
    <View style={[direction === "vertical" ? baseStyles.splitterLine : baseStyles.splitterLineHorizontal, { backgroundColor: color }]} />
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

function formatCommitTime(value: string, nowMs: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const elapsed = nowMs - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return "刚刚";
  if (elapsed >= 0 && elapsed < 60 * 60_000) {
    const minutes = Math.floor(elapsed / 60_000);
    return `${minutes} 分钟前`;
  }
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.getTime() >= today && date.getTime() <= nowMs) return `今天 ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (date.getTime() >= yesterday && date.getTime() < today) return `昨天 ${time}`;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${time}`;
}

export function GitHistoryPanel(props: PluginWorkspacePanelProps & { onOpenDiff(): void }) {
  const { workspaceId } = props;
  const colors = props.theme.colors;
  const styles = useMemo(() => historyStyles(colors), [colors]);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [focusedSearch, setFocusedSearch] = useState<"branch" | "commit" | null>(null);
  const getHistory = useRpc(gitHistoryRpc);
  const getDetail = useRpc(gitCommitDetailRpc);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [branch, setBranch] = useState("");
  const branchTreeRef = useRef<View>(null);
  const [activeBranchNode, setActiveBranchNode] = useState<string | null>(null);
  const branchFocus = useRef<string | null>(null);
  const branchNavigation = useRef(branch);
  branchNavigation.current = branch;
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const logRef = useRef<View>(null);
  const commitNodes = useRef(new Map<string, HTMLElement>());
  const navigation = useRef({ commits, selectedHash });
  navigation.current = { commits, selectedHash };

  const [detail, setDetail] = useState<{ message: string; files: ChangedFile[]; containingBranches: string[] } | null>(null);
  const [detailPanelHeight, setDetailPanelHeight] = useState(0);
  const [preferredFilesHeight, setPreferredFilesHeight] = useState<number | null>(null);
  const { activeTabId, openTab: selectTab, refresh: refreshDiff } = useGitDiffState(workspaceId);
  const openTab = (tab: DiffTab) => { selectTab(tab); props.onOpenDiff(); };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const filesTreeRef = useRef<View>(null);
  const [activeFileNode, setActiveFileNode] = useState<string | null>(null);
  const fileFocus = useRef<string | null>(null);
  const filePreview = useRef<(path: string) => void>(() => {});
  filePreview.current = (path) => {
    const file = detail?.files.find((entry) => entry.path === path);
    if (selectedHash && file) openTab({ id: `history:${selectedHash}:${path}`, source: "history", hash: selectedHash, path, status: file.status });
  };

  const [branchCollapsed, setBranchCollapsed] = useState<Set<string>>(new Set(["remote", "tag"]));
  const branchDefaultsWorkspace = useRef<string | null>(null);
  const requestSeq = useRef(0);
  const [branchSearch, setBranchSearch] = useState("");
  const [panelWidth, setPanelWidth] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const [branchColumnWidth, setBranchColumnWidth] = useState<number | null>(null);
  const [logColumnWidth, setLogColumnWidth] = useState<number | null>(null);
  const [error, setError] = useState("");

  const historyActions = useHistoryActions({ workspaceId, theme: props.theme, onCompare: openTab, onChanged: () => { setSkip(0); setRevision((value) => value + 1); refreshDiff(); } });

  useEffect(() => {
    if (Platform.OS !== "web" || !logRef.current) return;
    const node = logRef.current as unknown as HTMLElement;
    node.tabIndex = 0;
    node.style.setProperty("outline", "none", "important");
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]')) return;
      const current = navigation.current;
      if (!current.commits.length) return;
      event.preventDefault(); event.stopPropagation();
      const index = current.commits.findIndex((commit) => commit.hash === current.selectedHash);
      const next = index < 0 ? 0 : Math.max(0, Math.min(current.commits.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      const hash = current.commits[next].hash;
      navigation.current = { ...current, selectedHash: hash };
      setSelectedHash(hash);
      const row = commitNodes.current.get(hash);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    node.addEventListener("keydown", keydown);
    return () => node.removeEventListener("keydown", keydown);
  }, []);


  useEffect(() => {
    if (Platform.OS !== "web" || !branchTreeRef.current) return;
    const node = branchTreeRef.current as unknown as HTMLElement;
    node.tabIndex = 0;
    node.style.setProperty("outline", "none", "important");
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]')) return;
      const rows = Array.from(node.querySelectorAll<HTMLElement>("[data-branch-key]"));
      if (!rows.length) return;
      event.preventDefault(); event.stopPropagation();
      const focused = event.target instanceof Element ? event.target.closest("[data-branch-key]") : null;
      let index = focused ? rows.indexOf(focused as HTMLElement) : rows.findIndex((row) => row.dataset.branchKey === branchFocus.current);
      if (index < 0) index = rows.findIndex((row) => row.dataset.historyBranch === branchNavigation.current);
      const current = rows[index];
      let next = index;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        next = index < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      } else if (current) {
        const key = current.dataset.branchKey!;
        const folder = current.dataset.branchKind === "folder";
        if (event.key === "ArrowRight") {
          if (folder && current.dataset.branchExpanded === "false") {
            setBranchCollapsed((value) => { const result = new Set(value); result.delete(key); return result; });
            return;
          }
          if (folder && rows[index + 1]?.dataset.branchParent === key) next = index + 1;
        } else if (folder && current.dataset.branchExpanded === "true") {
          setBranchCollapsed((value) => new Set(value).add(key));
          return;
        } else {
          const parent = rows.findIndex((row) => row.dataset.branchKey === current.dataset.branchParent);
          if (parent >= 0) next = parent;
        }
      }
      const row = rows[next];
      if (!row) return;
      branchFocus.current = row.dataset.branchKey!;
      setActiveBranchNode(branchFocus.current);
      const name = row.dataset.historyBranch;
      if (name) { branchNavigation.current = name; setBranch(name); setSkip(0); }
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    node.addEventListener("keydown", keydown);
    return () => node.removeEventListener("keydown", keydown);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || !filesTreeRef.current) return;
    const node = filesTreeRef.current as unknown as HTMLElement;
    node.tabIndex = 0;
    node.style.setProperty("outline", "none", "important");
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]')) return;
      const rows = Array.from(node.querySelectorAll<HTMLElement>("[data-file-key]"));
      if (!rows.length) return;
      event.preventDefault(); event.stopPropagation();
      const focused = event.target instanceof Element ? event.target.closest("[data-file-key]") : null;
      const index = focused ? rows.indexOf(focused as HTMLElement) : rows.findIndex((row) => row.dataset.fileKey === fileFocus.current);
      const current = rows[index];
      let next = index;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        next = index < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      } else if (current) {
        const folder = current.dataset.fileKind === "folder";
        const path = current.dataset.filePath!;
        if (event.key === "ArrowRight") {
          if (folder && current.dataset.fileExpanded === "false") {
            setCollapsed((value) => { const result = new Set(value); result.delete(path); return result; });
            return;
          }
          if (folder && rows[index + 1]?.dataset.fileParent === current.dataset.fileKey) next = index + 1;
        } else if (folder && current.dataset.fileExpanded === "true") {
          setCollapsed((value) => new Set(value).add(path));
          return;
        } else {
          const parent = rows.findIndex((row) => row.dataset.fileKey === current.dataset.fileParent);
          if (parent >= 0) next = parent;
        }
      }
      const row = rows[next];
      if (!row) return;
      fileFocus.current = row.dataset.fileKey!;
      setActiveFileNode(fileFocus.current);
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    node.addEventListener("keydown", keydown);
    return () => node.removeEventListener("keydown", keydown);
  }, [selectedHash, detail]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { setSkip(0); setQuery(searchText); }, 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    void getHistory({ workspaceId, branch, query, skip }).then((value) => {
      // ponytail: discard stale responses to prevent cross-branch/dimension list splicing.
      if (seq !== requestSeq.current) return;
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
      setHasMore(value.hasMore);
      if (skip === 0) setSelectedHash(value.commits[0]?.hash ?? null);
      setError("");
    }, (reason: unknown) => { if (seq === requestSeq.current) setError(String(reason)); }).finally(() => { if (seq === requestSeq.current) setLoading(false); });
  }, [workspaceId, branch, query, skip, revision]);

  const detailSeq = useRef(0);
  useEffect(() => {
    const seq = ++detailSeq.current;
    setDetail(null); setActiveFileNode(null); fileFocus.current = null;
    if (selectedHash) void getDetail({ workspaceId, hash: selectedHash }).then((value) => {
      if (seq !== detailSeq.current) return;
      setDetail(value);
      setCollapsed(new Set());
    }, (reason: unknown) => { if (seq === detailSeq.current) setError(String(reason)); });
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
  const chooseBranch = (name: string, key?: string) => { setBranch(name); setSkip(0); setActiveBranchNode(key ?? null); branchFocus.current = key ?? null; };
  const bindBranchNode = (row: View | null, key: string, parent: string, name?: string, expanded?: boolean) => {
    if (Platform.OS !== "web" || !row) return;
    const element = row as unknown as HTMLElement;
    element.dataset.branchKey = key;
    element.dataset.branchParent = parent;
    element.dataset.branchKind = name ? "branch" : "folder";
    if (name) element.dataset.historyBranch = name;
    if (expanded !== undefined) element.dataset.branchExpanded = String(expanded);
    element.style.setProperty("outline", "none", "important");
  };
  const focusBranchNode = (key: string) => { branchFocus.current = key; setActiveBranchNode(key); };
  const renderBranches = (nodes: BranchNode[], group: Branch["group"], parent: string = group): React.ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") return <View key={node.path}>
      <Pressable ref={(row) => bindBranchNode(row, node.path, parent, undefined, !branchCollapsed.has(node.path) || Boolean(branchSearch.trim()))} onFocus={() => focusBranchNode(node.path)} accessibilityRole="button" accessibilityState={{ expanded: !branchCollapsed.has(node.path) || Boolean(branchSearch.trim()) }} accessibilityLabel={`${branchCollapsed.has(node.path) ? "展开" : "折叠"} ${node.name}`} onPress={() => { focusBranchNode(node.path); toggleBranchFolder(node.path); }} style={[styles.branchRow, activeBranchNode === node.path && styles.branchSelected]}>
        <Icon name={branchCollapsed.has(node.path) ? "ChevronRight" : "ChevronDown"} size={14} color={colors.foregroundMuted} />
        <Icon name="Folder" size={15} color={colors.foregroundMuted} />
        <Text style={styles.branchName} numberOfLines={1}>{node.name}</Text>
      </Pressable>
      {!branchCollapsed.has(node.path) || branchSearch.trim() ? <View style={styles.branchChildren}>{renderBranches(node.children, group, node.path)}</View> : null}
    </View>;
    const isCurrent = group === "local" && node.fullName === currentBranch;
    const isMain = (group === "local" && (node.fullName === "main" || node.fullName === "master")) || (group === "remote" && (node.fullName === "origin/main" || node.fullName === "origin/master"));
    return <ContextMenu key={`${group}/${node.fullName}`} theme={props.theme} compact={props.layout.compact} label={node.fullName} items={[
      { id: "history", label: "查看历史", icon: "GitBranch", onSelect: () => chooseBranch(node.fullName) },
      { id: "copy", label: group === "tag" ? "复制标签名称" : "复制分支名称", icon: "Copy", onSelect: () => copyText(node.fullName) },
    ]}><Pressable key={`${group}/${node.fullName}`} ref={(row) => bindBranchNode(row, `leaf:${group}/${node.fullName}`, parent, node.fullName)} onFocus={() => focusBranchNode(`leaf:${group}/${node.fullName}`)} accessibilityRole="button" accessibilityLabel={`查看${group === "tag" ? "标签" : "分支"} ${node.fullName}`} accessibilityState={{ selected: branch === node.fullName }} onPress={() => chooseBranch(node.fullName, `leaf:${group}/${node.fullName}`)} style={[{ flex: 1 }, styles.branchRow, (activeBranchNode === `leaf:${group}/${node.fullName}` || (!activeBranchNode && branch === node.fullName)) && styles.branchSelected]}>
      <View style={styles.branchIndent} />
      <View style={styles.branchIcon}>{isCurrent && isMain ? <Image source={{ uri: CURRENT_BRANCH_ICON }} style={styles.currentBranchIcon} /> : isMain ? <Text style={styles.mainBranchIcon}>★</Text> : <Icon name={group === "tag" || isCurrent ? "Tag" : "GitBranch"} size={16} color={isCurrent ? colors.accent : colors.foregroundMuted} />}</View>
      <Text style={[styles.branchLeafName, branch === node.fullName && styles.activeBranch]} numberOfLines={1}>{node.name}</Text>
      {group === "local" && (node.ahead > 0 || node.behind > 0) ? <View style={styles.branchTracking}>{node.behind > 0 ? <><Icon name="ArrowDownLeft" size={14} color="#3478f6" /><Text style={styles.behindCount}>{node.behind}</Text></> : null}{node.ahead > 0 ? <><Icon name="ArrowUpRight" size={14} color="#30a653" /><Text style={styles.aheadCount}>{node.ahead}</Text></> : null}</View> : null}
    </Pressable></ContextMenu>;
  });
  const bindFileNode = (row: View | null, key: string, parent: string, path: string, folder: boolean, expanded = false) => {
    if (Platform.OS !== "web" || !row) return;
    const element = row as unknown as HTMLElement;
    element.dataset.fileKey = key;
    element.dataset.fileParent = parent;
    element.dataset.filePath = path;
    element.dataset.fileKind = folder ? "folder" : "file";
    element.dataset.fileExpanded = String(expanded);
    element.style.setProperty("outline", "none", "important");
  };
  const focusFileNode = (key: string) => { fileFocus.current = key; setActiveFileNode(key); };
  const renderFiles = (nodes: TreeNode[], depth: number, parent = ""): React.ReactNode[] => nodes.map((node) => {
    if (node.kind === "folder") return <View key={node.path}>
      <Pressable ref={(row) => bindFileNode(row, `folder:${node.path}`, parent, node.path, true, !collapsed.has(node.path))} onFocus={() => focusFileNode(`folder:${node.path}`)} accessibilityRole="button" accessibilityState={{ expanded: !collapsed.has(node.path) }} accessibilityLabel={`${collapsed.has(node.path) ? "展开" : "折叠"} ${node.path}`} onPress={() => { focusFileNode(`folder:${node.path}`); toggleFolder(node.path); }} style={[styles.fileRow, { paddingLeft: 8 + depth * 18 }, activeFileNode === `folder:${node.path}` && styles.selected]}>
        <Icon name={collapsed.has(node.path) ? "ChevronRight" : "ChevronDown"} size={14} color={colors.foregroundMuted} />
        <View style={styles.fixedIcon}><Icon name="Folder" size={16} color={colors.foregroundMuted} /></View>
        <Text style={styles.folderName} numberOfLines={1}>{node.name}</Text>
        <Text style={styles.count}>{node.files.length} 个文件</Text>
      </Pressable>
      {!collapsed.has(node.path) ? renderFiles(node.children, depth + 1, `folder:${node.path}`) : null}
    </View>;
    const tabId = `history:${selectedHash}:${node.file.path}`;
    return <ContextMenu key={node.file.path} theme={props.theme} compact={props.layout.compact} label={node.file.path} items={[
      { id: "diff", label: "查看提交差异", icon: "FileDiff", disabled: !selectedHash, onSelect: () => { if (selectedHash) openTab({ id: tabId, source: "history", hash: selectedHash, path: node.file.path, status: node.file.status }); } },
      { id: "copy", label: "复制文件路径", icon: "Copy", onSelect: () => copyText(node.file.path) },
    ]}><Pressable key={node.file.path} ref={(row) => bindFileNode(row, `file:${node.file.path}`, parent, node.file.path, false)} onFocus={() => focusFileNode(`file:${node.file.path}`)} accessibilityRole="button" accessibilityLabel={`查看 ${node.file.path} 的提交差异`} onPress={() => { focusFileNode(`file:${node.file.path}`); filePreview.current(node.file.path); }} style={[{ flex: 1 }, styles.fileRow, { paddingLeft: 8 + depth * 18 }, (activeFileNode === `file:${node.file.path}` || (!activeFileNode && activeTabId === tabId)) && styles.selected]}>
      <View style={styles.fileIndent} />
      <View style={styles.fixedIcon}><FileTypeIcon fileName={node.name} /></View>
      <Text style={[styles.fileName, node.file.status.includes("D") ? styles.deleted : node.file.status.includes("A") ? styles.added : styles.modified]} numberOfLines={1}>{node.name}</Text>
    </Pressable></ContextMenu>;
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
        <View style={styles.headerTitle}><Icon name="GitBranch" size={14} color={colors.foregroundMuted} /><Text style={styles.historyTitle} numberOfLines={1}>{branch || "全部分支"}</Text><Text style={styles.headerCount}>{commits.length}{hasMore ? "+" : ""} 条提交</Text></View>
        <View style={styles.historyActions}>
          <ToolbarButton label="刷新提交历史" icon="RefreshCw" size={28} theme={props.theme} onPress={() => { setSkip(0); setRevision((value) => value + 1); }} />
        </View>
      </View>
      <View style={styles.bottomViewport}>
      <View style={[styles.columns, { height: Math.max(0, bottomHeight - 64) }]}>
        <View ref={branchTreeRef} style={[styles.sidebar, { width: resolvedBranchColumnWidth }]}>
          <View style={[styles.branchSearchRow, focusedSearch === "branch" && { borderColor: colors.accent }]}><Icon name="Search" size={16} color={colors.foregroundMuted} /><TextInput ref={borderOnlyFocus} accessibilityLabel="搜索分支或标签" onFocus={() => setFocusedSearch("branch")} onBlur={() => setFocusedSearch(null)} placeholderTextColor={colors.foregroundMuted} value={branchSearch} onChangeText={setBranchSearch} placeholder="搜索分支或标签" style={styles.branchSearchInput} /></View>
          <ScrollView style={styles.sidebarScroll}>
            {(["local", "remote", "tag"] as const).map((group) => {
              const query = branchSearch.trim().toLowerCase();
              const matching = branches.filter((item) => item.group === group && (!query || item.name.toLowerCase().includes(query)));
              if (!matching.length) return null;
              const label = group === "local" ? "本地分支" : group === "remote" ? "远程分支" : "标签";
              return <View key={group}>
                <Pressable ref={(row) => bindBranchNode(row, group, "", undefined, !branchCollapsed.has(group) || Boolean(query))} onFocus={() => focusBranchNode(group)} accessibilityRole="button" accessibilityState={{ expanded: !branchCollapsed.has(group) || Boolean(query) }} accessibilityLabel={`${branchCollapsed.has(group) ? "展开" : "折叠"}${label}`} onPress={() => { focusBranchNode(group); toggleBranchFolder(group); }} style={[styles.branchGroup, activeBranchNode === group && styles.branchSelected]}><Icon name={branchCollapsed.has(group) ? "ChevronRight" : "ChevronDown"} size={14} color={colors.foregroundMuted} /><Text style={styles.branchGroupText}>{label}</Text></Pressable>
                {!branchCollapsed.has(group) || query ? <View style={styles.branchChildren}>{renderBranches(branchTree(matching, group), group)}</View> : null}
              </View>;
            })}
          </ScrollView>
        </View>
        <ResizeHandle color={colors.border} direction="vertical" label="调整分支列表宽度" onResize={(delta) => setBranchColumnWidth((width) => Math.max(minimumBranchWidth, Math.min(maximumBranchWidth, Math.max(minimumBranchWidth, Math.min(maximumBranchWidth, width ?? resolvedBranchColumnWidth)) + delta)))} />
        <View ref={logRef} style={[styles.logColumn, { width: resolvedLogColumnWidth }]}>
          <View style={styles.logToolbar}><View style={[styles.commitSearchRow, focusedSearch === "commit" && { borderColor: colors.accent }]}><Icon name="Search" size={15} color={colors.foregroundMuted} /><TextInput ref={borderOnlyFocus} accessibilityLabel="搜索提交说明" value={searchText} onChangeText={setSearchText} onFocus={() => setFocusedSearch("commit")} onBlur={() => setFocusedSearch(null)} placeholder="搜索提交说明" placeholderTextColor={colors.foregroundMuted} style={styles.search} /></View></View>
          <ScrollView style={styles.log}>
            {commits.map((item) => {
              return <ContextMenu key={item.hash} theme={props.theme} compact={props.layout.compact} label={item.subject} items={[
                { id: "hash", label: "复制提交 Hash", icon: "Copy", onSelect: () => copyText(item.hash) },
                { id: "message", label: "复制提交说明", onSelect: async () => { const value = await getDetail({ workspaceId, hash: item.hash }); await copyText(value.message); } },
                ...historyActions.itemsFor(item),
              ]}><Pressable key={item.hash} ref={(row) => {
                if (Platform.OS !== "web") return;
                if (row) {
                  const node = row as unknown as HTMLElement;
                  node.style.setProperty("outline", "none", "important");
                  commitNodes.current.set(item.hash, node);
                } else commitNodes.current.delete(item.hash);
              }} accessibilityRole="button" accessibilityLabel={`查看提交 ${item.subject}`} accessibilityState={{ selected: selectedHash === item.hash }} onPress={() => setSelectedHash(item.hash)} onHoverIn={() => setHoveredHash(item.hash)} onHoverOut={() => setHoveredHash(null)} style={({ pressed }) => [styles.commitRow, { backgroundColor: selectedHash === item.hash ? colors.surface2 : hoveredHash === item.hash || pressed ? colors.surface1 : "transparent" }]}>
                <Text style={styles.author} numberOfLines={1}>{item.author}</Text>
                <View style={styles.graph}><View style={styles.graphLine} /><View style={[styles.graphDot, item.parents.length > 1 && styles.mergeDot]} /></View>
                <View style={styles.subjectLine}>
                  <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
                  {item.refs[0] ? <View style={styles.refBadge}><Icon name="GitBranch" size={10} color={colors.accent} /><Text style={styles.ref} numberOfLines={1}>{item.refs[0]}</Text></View> : null}
                </View>
                <Text style={styles.date} numberOfLines={1}>{formatCommitTime(item.date, nowMs)}</Text>
                <Text style={styles.hash} numberOfLines={1}>{item.hash.slice(0, 8)}</Text>
              </Pressable></ContextMenu>;
            })}
            {hasMore ? <Pressable accessibilityRole="button" onPress={() => { if (!loading) setSkip((value) => value + 50); }} style={styles.loadMore}><Text style={styles.loadMoreText}>{loading ? "加载中…" : "加载更多提交"}</Text></Pressable> : null}
            {!loading && commits.length === 0 ? <Text style={styles.empty}>没有找到提交记录</Text> : null}
          </ScrollView>
        </View>
        <ResizeHandle color={colors.border} direction="vertical" label="调整提交列表宽度" onResize={(delta) => setLogColumnWidth((width) => Math.max(minimumLogWidth, Math.min(maximumLogWidth, Math.max(minimumLogWidth, Math.min(maximumLogWidth, width ?? resolvedLogColumnWidth)) + delta)))} />
        <View style={styles.detail} onLayout={(event) => setDetailPanelHeight(event.nativeEvent.layout.height)}>
          {selectedCommit ? <>
            <View ref={filesTreeRef} style={[styles.filesSection, { height: filesHeight }]}><Text style={styles.columnHeading}>变更文件 {detail?.files.length ?? ""}</Text><ScrollView style={styles.files}>{detail ? renderFiles(buildFileTree(detail.files, true), 0) : <Text style={styles.empty}>加载变更文件…</Text>}</ScrollView></View>
            <ResizeHandle color={colors.border} direction="horizontal" label="调整变更文件与提交说明的高度" onResize={(delta) => setPreferredFilesHeight((height) => Math.max(minimumFilesHeight, Math.min(maximumFilesHeight, Math.max(minimumFilesHeight, Math.min(maximumFilesHeight, height ?? filesHeight)) + delta)))} />
            <ScrollView key={selectedCommit.hash} style={styles.detailMessageScroll} contentContainerStyle={styles.detailMessageContent}>
              <Text selectable style={styles.detailMessage}>{detail?.message ?? selectedCommit.subject}</Text>
              <View style={styles.detailMetaGroup}><Text selectable style={styles.detailMeta}>{selectedCommit.author}</Text><Text selectable style={styles.detailMeta}>{selectedCommit.email}</Text><Text style={styles.detailMeta}>{new Date(selectedCommit.date).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</Text><Text selectable style={[styles.detailMeta, styles.detailHash]}>{selectedCommit.hash.slice(0, 8)}</Text></View>
              {detail?.containingBranches.length ? <Text style={styles.detailMeta}>所在分支 · {detail.containingBranches.join("、")}</Text> : null}
            </ScrollView>
          </> : <Text style={styles.empty}>选择一条提交查看详情</Text>}
        </View>
      </View>
    </View>
      <View style={styles.historyFooter}><Icon name="GitBranch" size={13} color={colors.foregroundMuted} /><Text style={styles.historyBranch} numberOfLines={1}>{currentBranch || "未检测到分支"}</Text></View>
    </View>
    {historyActions.dialog}
    {error ? <Text style={styles.error} numberOfLines={2}>{error}</Text> : null}
  </View>;
}

const baseStyles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: "#fff" },
  verticalLineSplitter: { width: SPLITTER_SIZE, alignItems: "center" },
  splitterLine: { width: 1, height: "100%", backgroundColor: "#d1d5db" },
  horizontalLineSplitter: { height: SPLITTER_SIZE, justifyContent: "center" },
  splitterLineHorizontal: { height: 1, width: "100%", backgroundColor: "#d1d5db" },
  bottomPanel: { minHeight: 0, overflow: "hidden", backgroundColor: "#fff" },
  historyHeader: { height: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 10, paddingRight: 7, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  historyActions: { flexDirection: "row", alignItems: "center", gap: 3 },
  bottomViewport: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  historyFooter: { height: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, paddingHorizontal: 10, borderTopWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#f8fafc" },
  historyBranch: { fontSize: 11, color: "#64748b" },
  columns: { flexDirection: "row", minWidth: 0, minHeight: 0 },
  sidebar: { minHeight: 0 },
  sidebarScroll: { flex: 1, minHeight: 0 },
  branchSearchInput: { flex: 1, minWidth: 0, fontSize: 12, color: "#111827" },
  columnHeading: { paddingHorizontal: 10, paddingVertical: 9, fontSize: 12, fontWeight: "600", color: "#374151", borderBottomWidth: 1, borderColor: "#e5e7eb" },
  branchGroup: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10 },
  branchRow: { minHeight: 29, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  branchIndent: { width: 14 },
  branchIcon: { width: 18, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  branchName: { flex: 1, fontSize: 12, color: "#374151" },
  branchLeafName: { minWidth: 0, flexShrink: 1, fontSize: 12, color: "#374151" },
  branchTracking: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 8, flexShrink: 0 },
  aheadCount: { fontSize: 11, color: "#30a653" },
  behindCount: { fontSize: 11, color: "#3478f6" },
  mainBranchIcon: { width: 14, fontSize: 18, lineHeight: 20, color: "#f5a400", textAlign: "center" },
  currentBranchIcon: { width: 16, height: 16 },
  logColumn: { minWidth: 0, minHeight: 0 },
  log: { flex: 1, minHeight: 0 },
  graph: { width: 24, height: 36, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  graphLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "#b19bd2" },
  loadMore: { alignItems: "center", padding: 12 },
  loadMoreText: { color: "#1641ad", fontSize: 12 },
  detail: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  filesSection: { minHeight: 0 },
  detailMessageScroll: { flex: 1, minHeight: 0 },
  files: { flex: 1, minHeight: 0 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, paddingRight: 8 },
  fileIndent: { width: 14 },
  folderName: { fontSize: 12, color: "#374151", flexShrink: 1 },
  count: { fontSize: 10, color: "#9ca3af" },
  fileName: { fontSize: 12, flexShrink: 1 },
  empty: { padding: 12, fontSize: 12, color: "#6b7280" },
  error: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 9, paddingVertical: 5, color: "#b91c1c", backgroundColor: "#fff", fontSize: 11 },
});

function historyStyles(colors: PluginWorkspacePanelProps["theme"]["colors"]) {
  return StyleSheet.create({
    ...baseStyles,
    root: { ...baseStyles.root, backgroundColor: colors.surface0 },
    bottomPanel: { ...baseStyles.bottomPanel, backgroundColor: colors.surface0 },
    historyHeader: { ...baseStyles.historyHeader, height: 40, paddingHorizontal: 12, borderColor: colors.border },
    headerTitle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
    historyTitle: { flexShrink: 1, fontSize: 12, fontWeight: "500", color: colors.foreground },
    headerCount: { fontSize: 11, color: colors.foregroundMuted, marginLeft: 4 },
    historyFooter: { ...baseStyles.historyFooter, backgroundColor: colors.surface1, borderColor: colors.border },
    historyBranch: { ...baseStyles.historyBranch, color: colors.foregroundMuted },
    sidebar: { ...baseStyles.sidebar, backgroundColor: colors.surface1 },
    branchSearchRow: { height: 30, flexDirection: "row", alignItems: "center", gap: 8, margin: 8, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surface0 },
    branchSearchInput: { ...baseStyles.branchSearchInput, color: colors.foreground, outlineWidth: 0, paddingVertical: 0 },
    branchGroupText: { fontSize: 11, fontWeight: "500", color: colors.foregroundMuted },
    branchChildren: { marginLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.border },
    branchRow: { ...baseStyles.branchRow, minHeight: 28 },
    branchName: { ...baseStyles.branchName, minWidth: 0, color: colors.foreground },
    branchLeafName: { ...baseStyles.branchLeafName, color: colors.foreground },
    branchSelected: { backgroundColor: colors.surface2, borderRadius: 4 },
    activeBranch: { color: colors.accent, fontWeight: "500" },
    logToolbar: { height: 46, padding: 8, borderBottomWidth: 1, borderColor: colors.border },
    commitSearchRow: { flex: 1, height: 30, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surface1 },
    search: { flex: 1, minWidth: 0, fontSize: 12, color: colors.foreground, outlineWidth: 0, paddingVertical: 0 },
    commitRow: { flex: 1, flexDirection: "row", alignItems: "center", height: 36, paddingLeft: 10, paddingRight: 12, gap: 6 },
    graph: { ...baseStyles.graph, width: 24, height: 36 },
    graphLine: { ...baseStyles.graphLine, width: 1, backgroundColor: colors.border },
    graphDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
    mergeDot: { backgroundColor: colors.surface0, borderWidth: 2, borderColor: colors.accent, width: 9, height: 9, borderRadius: 5 },
    subjectLine: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
    subject: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18, fontWeight: "400", color: colors.foreground },
    refBadge: { maxWidth: 130, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 4, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 5, paddingVertical: 1 },
    ref: { flexShrink: 1, fontSize: 10, lineHeight: 14, color: colors.accent },
    author: { width: 80, minWidth: 40, flexShrink: 1, fontSize: 11, lineHeight: 16, color: colors.foregroundMuted },
    date: { width: 105, minWidth: 0, flexShrink: 1, fontSize: 11, lineHeight: 16, color: colors.foregroundMuted },
    hash: { width: 56, flexShrink: 0, fontFamily: "monospace", fontSize: 10, color: colors.foregroundMuted },
    selected: { backgroundColor: colors.surface2 },
    columnHeading: { ...baseStyles.columnHeading, fontSize: 11, fontWeight: "500", paddingVertical: 10, color: colors.foregroundMuted, borderColor: colors.border },
    detailMessageContent: { padding: 12, gap: 16 },
    detailMessage: { fontSize: 12, lineHeight: 20, color: colors.foreground },
    detailMetaGroup: { gap: 4 },
    detailMeta: { fontSize: 11, lineHeight: 17, color: colors.foregroundMuted },
    detailHash: { fontFamily: "monospace", marginTop: 4 },
    fixedIcon: { width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center" },
    folderName: { ...baseStyles.folderName, minWidth: 0, color: colors.foreground },
    count: { ...baseStyles.count, flexShrink: 0, color: colors.foregroundMuted },
    fileName: { ...baseStyles.fileName, minWidth: 0 },
    added: { color: colors.statusSuccess },
    modified: { color: "#1641ad" },
    deleted: { color: "#6c707e" },
    empty: { ...baseStyles.empty, color: colors.foregroundMuted },
    loadMoreText: { ...baseStyles.loadMoreText, color: colors.accent },
    error: { ...baseStyles.error, backgroundColor: colors.surface0, color: colors.statusDanger },
  });
}
