import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { parseDiffFiles, type DiffFile } from "./diff";
import { FileTypeIcon } from "./file-icons";
import { SplitDiff } from "./split-diff";
import { DiffOptionButton, WrapToggleButton } from "./wrap-toggle";
import { buildFileTree, type FileTreeNode } from "./file-tree-utils";

type TreeNode = FileTreeNode<DiffFile>;

export function FileTree({ files, fullDiff, collapseFoldersInitially = false }: { files: DiffFile[]; fullDiff?: string; collapseFoldersInitially?: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const folders = new Set<string>();
    if (!collapseFoldersInitially) return folders;
    for (const file of files) {
      const parts = file.path.split("/").filter(Boolean);
      for (let depth = 1; depth < parts.length; depth++) {
        folders.add(parts.slice(0, depth).join("/"));
      }
    }
    return folders;
  });
  const [openFile, setOpenFile] = useState<number | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);
  const [syncScrolling, setSyncScrolling] = useState(true);
  const fullFiles = useMemo(() => parseDiffFiles(fullDiff), [fullDiff]);
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
          accessibilityLabel={`${node.path}，${node.files.length} 个文件，${isCollapsed ? "展开" : "收起"}`}
          accessibilityState={{ expanded: !isCollapsed }}
          onPress={() => toggleFolder(node.path)}
          style={[styles.row, { paddingLeft: 12 + depth * 20 }]}
        >
          <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} size={15} color="#6b7280" />
          <Text style={styles.folderName} numberOfLines={1}>{node.name}</Text>
          <Text style={styles.count}>{node.files.length} 个文件</Text>
        </TouchableOpacity>
        {!isCollapsed ? renderNodes(node.children, depth + 1) : null}
      </View>;
    }
    const { file, index } = node;
    const isOpen = openFile === index;
    const fullFile = fullFiles.find((item) => item.path === file.path) ?? null;
    return <View key={`file:${file.path}`}>
      <View style={[styles.row, isOpen && styles.selected, { paddingLeft: 12 + depth * 20 }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${file.path}，新增 ${file.added} 行，删除 ${file.removed} 行`}
          accessibilityState={{ expanded: isOpen }}
          onPress={() => {
            setOpenFile(isOpen ? null : index);
            setWrapLines(false);
          }}
          style={styles.fileSelect}
        >
          <View style={styles.fileIndent} />
          <FileTypeIcon fileName={node.name} />
          <Text style={[styles.fileName, fileNameColors[file.status]]} numberOfLines={1}>{node.name}</Text>
        </TouchableOpacity>
        {isOpen ? <View style={styles.fileActions}><DiffOptionButton active={collapseUnchanged} onToggle={() => setCollapseUnchanged((current) => !current)} label="折叠未变更代码" icon="ChevronsDownUp" disabled={!fullFile} /><DiffOptionButton active={syncScrolling} onToggle={() => setSyncScrolling((current) => !current)} label="左右同步滚动" icon="ArrowDownUp" /><WrapToggleButton active={wrapLines} onToggle={() => setWrapLines((current) => !current)} /></View> : null}
        <Text style={styles.added}>+{file.added}</Text>
        <Text style={styles.removed}>-{file.removed}</Text>
      </View>
      {isOpen ? <SplitDiff file={file} wrapLines={wrapLines} collapseUnchanged={collapseUnchanged} syncScrolling={syncScrolling} loadFullFile={fullFile ? async () => fullFile : undefined} /> : null}
    </View>;
  });

  return <View>{renderNodes(nodes, 0)}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34, paddingRight: 12 },
  selected: { backgroundColor: "#e8f0ff", zIndex: 3 },
  fileSelect: { flex: 1, minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6 },
  fileActions: { flexDirection: "row", alignItems: "center", gap: 4, position: "relative", zIndex: 2 },
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
