import { useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { DiffFile } from "./diff";
import { FileTypeIcon } from "./file-icons";
import { SplitDiff } from "./split-diff";

type FolderNode = { kind: "folder"; name: string; path: string; count: number; children: TreeNode[] };
type FileNode = { kind: "file"; name: string; file: DiffFile; index: number };
type TreeNode = FolderNode | FileNode;

function buildFileTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, FolderNode>();
  files.forEach((file, index) => {
    const parts = file.path.split("/").filter(Boolean);
    let children = root;
    let path = "";
    for (const name of parts.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: "folder", name, path, count: 0, children: [] };
        folders.set(path, folder);
        children.push(folder);
      }
      folder.count++;
      children = folder.children;
    }
    children.push({ kind: "file", name: parts.at(-1) ?? file.path, file, index });
  });
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1);
    nodes.forEach((node) => { if (node.kind === "folder") sortNodes(node.children); });
  };
  sortNodes(root);
  return root;
}

export function FileTree({ files }: { files: DiffFile[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [openFile, setOpenFile] = useState<number | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const [showWrapTooltip, setShowWrapTooltip] = useState(false);
  const nodes = buildFileTree(files);

  const toggleFolder = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const renderNodes = (items: TreeNode[], depth: number): React.ReactNode[] => items.map((node) => {
    if (node.kind === "folder") {
      const isCollapsed = collapsed.has(node.path);
      return <View key={`folder:${node.path}`}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${node.path}，${node.count} 个文件，${isCollapsed ? "展开" : "收起"}`}
          accessibilityState={{ expanded: !isCollapsed }}
          onPress={() => toggleFolder(node.path)}
          style={[styles.row, { paddingLeft: 12 + depth * 20 }]}
        >
          <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} size={15} color="#6b7280" />
          <Text style={styles.folderName} numberOfLines={1}>{node.name}</Text>
          <Text style={styles.count}>{node.count} 个文件</Text>
        </TouchableOpacity>
        {!isCollapsed ? renderNodes(node.children, depth + 1) : null}
      </View>;
    }
    const { file, index } = node;
    const isOpen = openFile === index;
    return <View key={`file:${file.path}`}>
      <View style={[styles.row, isOpen && styles.selected, { paddingLeft: 12 + depth * 20 }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${file.path}，新增 ${file.added} 行，删除 ${file.removed} 行`}
          accessibilityState={{ expanded: isOpen }}
          onPress={() => {
            setOpenFile(isOpen ? null : index);
            setWrapLines(false);
            setShowWrapTooltip(false);
          }}
          style={styles.fileSelect}
        >
          <View style={styles.fileIndent} />
          <FileTypeIcon fileName={node.name} />
          <Text style={[styles.fileName, fileNameColors[file.status]]} numberOfLines={1}>{node.name}</Text>
        </TouchableOpacity>
        {isOpen ? <View style={styles.fileActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="折行显示"
            aria-pressed={wrapLines}
            onHoverIn={() => setShowWrapTooltip(true)}
            onHoverOut={() => setShowWrapTooltip(false)}
            onPress={() => setWrapLines((current) => !current)}
            style={[styles.actionButton, wrapLines && styles.actionButtonActive, showWrapTooltip && styles.actionButtonHover]}
          >
            <Icon name="WrapText" size={13} color="#64748b" />
          </Pressable>
          {showWrapTooltip ? <View style={styles.tooltip}><Text style={styles.tooltipText}>折行显示</Text></View> : null}
        </View> : null}
        <Text style={styles.added}>+{file.added}</Text>
        <Text style={styles.removed}>-{file.removed}</Text>
      </View>
      {isOpen ? <SplitDiff file={file} wrapLines={wrapLines} /> : null}
    </View>;
  });

  return <View>{renderNodes(nodes, 0)}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34, paddingRight: 12 },
  selected: { backgroundColor: "#e8f0ff", zIndex: 3 },
  fileSelect: { flex: 1, minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6 },
  fileActions: { flexDirection: "row-reverse", alignItems: "center", gap: 4, position: "relative", zIndex: 2 },
  actionButton: { width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  actionButtonActive: { backgroundColor: "#cbcbcd" },
  actionButtonHover: { backgroundColor: "#e5e7eb" },
  tooltip: { position: "absolute", bottom: 24, right: 0, width: 72, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 5, backgroundColor: "#1e293b", zIndex: 4 },
  tooltipText: { color: "#fff", fontSize: 11, textAlign: "center" },
  folderName: { color: "#111827", fontSize: 12, fontWeight: "600", flexShrink: 1 },
  count: { color: "#6b7280", fontSize: 11 },
  fileIndent: { width: 15 },
  fileName: { fontSize: 12, flex: 1 },
  added: { color: "#077d18", fontSize: 12, fontWeight: "600" },
  removed: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
});

const fileNameColors = StyleSheet.create({
  added: { color: "#077d18" },
  modified: { color: "#0133b3" },
  deleted: { color: "#6c707e" },
});
