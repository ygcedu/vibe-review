import { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, ScrollView, StyleSheet, Text, View, type PointerEvent as RNPointerEvent } from "react-native";
import type { DiffCell, DiffFile } from "./diff";
import { buildSplitDiffRows } from "./diff";

const DIVIDER_WIDTH = 14;

function clampRatio(ratio: number, width: number): number {
  const minRatio = Math.min(0.35, 160 / Math.max(width, 1));
  return Math.max(minRatio, Math.min(1 - minRatio, ratio));
}

function CodeCell({ cell, paired, width }: { cell?: DiffCell; paired: boolean; width: number }) {
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
    <View style={[styles.cell, background, { width }]}>
      <Text style={styles.lineNumber}>{cell?.number ?? ""}</Text>
      <Text selectable style={styles.codeText}>{cell?.text ?? " "}</Text>
    </View>
  );
}

/** Two aligned panes modeled after an IDE side-by-side diff. */
export function SplitDiff({ file }: { file: DiffFile }) {
  const rows = buildSplitDiffRows(file.lines);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(0.5);
  const widthRef = useRef(0);
  const ratioRef = useRef(0.5);
  const dragStartRatio = useRef(0.5);
  const webDrag = useRef<{ startX: number; startRatio: number } | null>(null);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStartRatio.current = ratioRef.current; },
    onPanResponderMove: (_event, gesture) => {
      const next = clampRatio(dragStartRatio.current + gesture.dx / Math.max(widthRef.current, 1), widthRef.current);
      ratioRef.current = next;
      setRatio(next);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const leftWidth = Math.round(width * clampRatio(ratio, width));
  const rightWidth = width - leftWidth;
  const webPointerHandlers = Platform.OS === "web" ? {
    onPointerDown: (event: RNPointerEvent) => {
      event.preventDefault();
      (event.currentTarget as unknown as HTMLElement).setPointerCapture(event.nativeEvent.pointerId);
      webDrag.current = { startX: event.nativeEvent.clientX, startRatio: ratioRef.current };
    },
    onPointerMove: (event: RNPointerEvent) => {
      if (!webDrag.current) return;
      const next = clampRatio(webDrag.current.startRatio + (event.nativeEvent.clientX - webDrag.current.startX) / Math.max(widthRef.current, 1), widthRef.current);
      ratioRef.current = next;
      setRatio(next);
    },
    onPointerUp: () => { webDrag.current = null; },
    onPointerCancel: () => { webDrag.current = null; },
  } : panResponder.panHandlers;

  return (
    <View
      style={styles.viewport}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        widthRef.current = nextWidth;
        setWidth(nextWidth);
      }}
    >
      {width > 0 ? <ScrollView style={styles.verticalScroll} nestedScrollEnabled>
        <View style={[styles.table, { width }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.paneHeading, { width: leftWidth }]}>修改前</Text>
            <Text style={[styles.paneHeading, styles.rightHeading, { width: rightWidth }]}>修改后</Text>
          </View>
          {rows.map((row, index) => row.kind === "header" ? (
            <View key={index} style={styles.hunkRow}>
              <Text style={styles.hunkText}>{row.label}</Text>
            </View>
          ) : (
            <View key={index} style={styles.codeRow}>
              <CodeCell cell={row.before} width={leftWidth} paired={Boolean(row.before && row.after && row.before.type !== "context" && row.after.type !== "context")} />
              <CodeCell cell={row.after} width={rightWidth} paired={Boolean(row.before && row.after && row.before.type !== "context" && row.after.type !== "context")} />
            </View>
          ))}
        </View>
      </ScrollView> : null}
      {width > 0 ? (
        <View
          {...webPointerHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="调整左右对照宽度"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
          accessibilityActions={[{ name: "increment", label: "增加左栏宽度" }, { name: "decrement", label: "减小左栏宽度" }]}
          onAccessibilityAction={(event) => {
            const direction = event.nativeEvent.actionName === "increment" ? 1 : -1;
            const next = clampRatio(ratioRef.current + direction * 0.05, widthRef.current);
            ratioRef.current = next;
            setRatio(next);
          }}
          style={[styles.divider, { left: leftWidth - DIVIDER_WIDTH / 2 }]}
        >
          <View style={styles.dividerLine} />
          <View style={styles.dividerGrip} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { position: "relative", minHeight: 32 },
  verticalScroll: { maxHeight: 520 },
  table: { backgroundColor: "#fff" },
  headerRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#d7dee8" },
  paneHeading: { paddingHorizontal: 12, paddingVertical: 7, color: "#64748b", fontSize: 11, fontWeight: "700", backgroundColor: "#f8fafc" },
  rightHeading: { borderLeftWidth: 1, borderLeftColor: "#d7dee8" },
  hunkRow: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: "#e9f0fb", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#cbdaf4" },
  hunkText: { color: "#4b6287", fontFamily: "monospace", fontSize: 10 },
  codeRow: { flexDirection: "row", alignItems: "stretch" },
  cell: { flexDirection: "row", minHeight: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#edf0f4" },
  contextCell: { backgroundColor: "#fff" },
  modifiedCell: { backgroundColor: "#dceaff" },
  removedCell: { backgroundColor: "#ffe7e7" },
  addedCell: { backgroundColor: "#e3f5e9" },
  emptyCell: { backgroundColor: "#f5f7fa" },
  lineNumber: { width: 38, paddingRight: 7, paddingTop: 3, color: "#94a3b8", backgroundColor: "#f8fafc", textAlign: "right", fontFamily: "monospace", fontSize: 10 },
  codeText: { flex: 1, paddingHorizontal: 9, paddingVertical: 3, color: "#263445", fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
  divider: { position: "absolute", top: 0, bottom: 0, width: DIVIDER_WIDTH, alignItems: "center", justifyContent: "center", cursor: "pointer" },
  dividerLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "#cbd5e1" },
  dividerGrip: { width: 5, height: 32, borderRadius: 4, backgroundColor: "#94a3b8" },
});
