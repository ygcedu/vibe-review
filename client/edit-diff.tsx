import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { z } from "zod";
import { parseDiffFiles } from "./diff";
import { FileTypeIcon } from "./file-icons";
import { SplitDiff } from "./split-diff";
import { DiffOptionButton, WrapToggleButton } from "./wrap-toggle";
import { editFullDiffRpc } from "../shared/edit-diff";

export const EDIT_DIFF_KIND = "edit-diff";
export const editDiffSchema = z.object({ path: z.string(), diff: z.string(), status: z.string() });

export function EditDiffItem({ item, theme, agentId }: PluginTimelineItemProps<z.output<typeof editDiffSchema>>) {
  const getFullDiff = useRpc(editFullDiffRpc);
  const [openFile, setOpenFile] = useState<number | null>(null);
  const [hoveredFile, setHoveredFile] = useState<number | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);
  const [syncScrolling, setSyncScrolling] = useState(true);
  const [fullContextUnavailable, setFullContextUnavailable] = useState(false);
  const files = useMemo(() => parseDiffFiles(item.data.diff), [item.data.diff]);
  if (files.length === 1) files[0]!.path = item.data.path;
  const loadFullFile = async (path: string) => {
    try {
      const result = await getFullDiff({ agentId, path, diff: item.data.diff });
      const full = parseDiffFiles(result.diff)[0] ?? null;
      if (full) full.path = path;
      return full;
    } catch {
      setCollapseUnchanged(true);
      setFullContextUnavailable(true);
      return null;
    }
  };

  return <View>{files.map((file, index) => {
    const open = openFile === index;
    const active = open || hoveredFile === index;
    return <View key={`${index}:${file.path}`}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${file.path}，新增 ${file.added} 行，删除 ${file.removed} 行`}
          accessibilityState={{ expanded: open }}
          onHoverIn={() => setHoveredFile(index)}
          onHoverOut={() => setHoveredFile((current) => current === index ? null : current)}
          onPress={() => { setOpenFile(open ? null : index); setWrapLines(false); setFullContextUnavailable(false); }}
          style={styles.fileButton}
        >
          <View style={styles.iconSlot}>
            <View style={active ? styles.chevronNudge : styles.pencilNudge}>
              <Icon name={open ? "ChevronDown" : active ? "ChevronRight" : "Pencil"} size={12} color={active ? theme.colors.foreground : theme.colors.foregroundMuted} />
            </View>
          </View>
          <Text style={[styles.editLabel, { color: active ? theme.colors.foreground : theme.colors.foregroundMuted }]}>Edit</Text>
          <FileTypeIcon fileName={file.path} />
          <Text style={styles.path} numberOfLines={1}>{file.path}</Text>
          {/* TODO(Paseo): Add a file-page shortcut here when timeline renderer props expose a supported openFile navigation API. */}
        </Pressable>
        {open ? <View style={styles.actions}><DiffOptionButton active={collapseUnchanged} onToggle={() => setCollapseUnchanged((value) => !value)} label="折叠未变更代码" icon="ChevronsDownUp" disabled={fullContextUnavailable} disabledReason="当前文件无法还原完整上下文" /><DiffOptionButton active={syncScrolling} onToggle={() => setSyncScrolling((value) => !value)} label="左右同步滚动" icon="ArrowDownUp" /><WrapToggleButton active={wrapLines} onToggle={() => setWrapLines((value) => !value)} /></View> : null}
        <Text style={styles.added}>+{file.added}</Text>
        <Text style={styles.removed}>-{file.removed}</Text>
      </View>
      {open ? <SplitDiff file={file} wrapLines={wrapLines} collapseUnchanged={collapseUnchanged} syncScrolling={syncScrolling} loadFullFile={fullContextUnavailable ? undefined : () => loadFullFile(file.path)} /> : null}
    </View>;
  })}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 30, marginHorizontal: -13, paddingHorizontal: 8, position: "relative", zIndex: 3 },
  fileButton: { flex: 1, minWidth: 0, minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7 },
  iconSlot: { width: 22, height: 22, alignItems: "center", justifyContent: "center", marginRight: -3 },
  pencilNudge: { marginLeft: -1 },
  chevronNudge: { marginLeft: -4, transform: [{ scale: 1.3 }] },
  editLabel: { fontSize: 14 },
  path: { fontSize: 14, flexShrink: 1, color: "#0133b3" },
  actions: { flexDirection: "row", alignItems: "center", gap: 5, position: "relative", zIndex: 4 },
  added: { color: "#077d18", fontSize: 14, fontWeight: "600" },
  removed: { color: "#b91c1c", fontSize: 14, fontWeight: "600" },
});
