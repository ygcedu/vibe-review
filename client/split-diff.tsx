import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { DiffCell, DiffFile } from "./diff";
import { buildSplitDiffRows } from "./diff";

const PANE_WIDTH = 490;

function CodeCell({ cell, paired }: { cell?: DiffCell; paired: boolean }) {
  const background = !cell
    ? styles.emptyCell
    : cell.type === "context"
      ? styles.contextCell
      : paired
        ? styles.modifiedCell
        : cell.type === "remove"
          ? styles.removedCell
          : styles.addedCell;
  return (
    <View style={[styles.cell, background]}>
      <Text style={styles.lineNumber}>{cell?.number ?? ""}</Text>
      <Text selectable style={styles.codeText}>{cell?.text ?? " "}</Text>
    </View>
  );
}

/** Two aligned panes modeled after an IDE side-by-side diff. */
export function SplitDiff({ file }: { file: DiffFile }) {
  const rows = buildSplitDiffRows(file.lines);
  return (
    <ScrollView style={styles.verticalScroll} nestedScrollEnabled>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
        <View style={styles.table}>
          <View style={styles.headerRow}>
            <Text style={styles.paneHeading}>修改前</Text>
            <Text style={[styles.paneHeading, styles.rightHeading]}>修改后</Text>
          </View>
          {rows.map((row, index) => row.kind === "header" ? (
            <View key={index} style={styles.hunkRow}>
              <Text style={styles.hunkText}>{row.label}</Text>
            </View>
          ) : (
            <View key={index} style={styles.codeRow}>
              <CodeCell cell={row.before} paired={Boolean(row.before && row.after && row.before.type !== "context" && row.after.type !== "context")} />
              <CodeCell cell={row.after} paired={Boolean(row.before && row.after && row.before.type !== "context" && row.after.type !== "context")} />
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  verticalScroll: { maxHeight: 520 },
  table: { width: PANE_WIDTH * 2, backgroundColor: "#fff" },
  headerRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#d7dee8" },
  paneHeading: { width: PANE_WIDTH, paddingHorizontal: 12, paddingVertical: 7, color: "#64748b", fontSize: 11, fontWeight: "700", backgroundColor: "#f8fafc" },
  rightHeading: { borderLeftWidth: 1, borderLeftColor: "#d7dee8" },
  hunkRow: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: "#e9f0fb", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#cbdaf4" },
  hunkText: { color: "#4b6287", fontFamily: "monospace", fontSize: 10 },
  codeRow: { flexDirection: "row", alignItems: "stretch" },
  cell: { width: PANE_WIDTH, flexDirection: "row", minHeight: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#edf0f4" },
  contextCell: { backgroundColor: "#fff" },
  modifiedCell: { backgroundColor: "#dceaff" },
  removedCell: { backgroundColor: "#ffe7e7" },
  addedCell: { backgroundColor: "#e3f5e9" },
  emptyCell: { backgroundColor: "#f5f7fa" },
  lineNumber: { width: 38, paddingRight: 7, paddingTop: 3, color: "#94a3b8", backgroundColor: "#f8fafc", textAlign: "right", fontFamily: "monospace", fontSize: 10 },
  codeText: { flex: 1, paddingHorizontal: 9, paddingVertical: 3, color: "#263445", fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
});
