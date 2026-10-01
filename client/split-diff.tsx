import { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, ScrollView, StyleSheet, Text, View, type PointerEvent as RNPointerEvent, type ViewStyle } from "react-native";
import type { DiffCell, DiffFile } from "./diff";
import { buildSplitDiffRows } from "./diff";

const DIVIDER_WIDTH = 14;
const changeColors = { modify: "#dceaff", add: "#e3f5e9", remove: "#ffe7e7" } as const;
const edgeColors = { modify: "#a9c9ee", add: "#a7dcb5", remove: "#efb4b4" } as const;

function clampRatio(ratio: number, width: number): number {
  const minRatio = Math.min(0.35, 160 / Math.max(width, 1));
  return Math.max(minRatio, Math.min(1 - minRatio, ratio));
}

function CodeLine({ cell, side, tone }: { cell: DiffCell; side: "before" | "after"; tone?: keyof typeof changeColors }) {
  return (
    <View style={[styles.cell, tone ? { backgroundColor: changeColors[tone] } : styles.contextCell]}>
      {side === "before" ? (
        <>
          <Text selectable style={[styles.codeText, styles.beforeCode]}>{cell.text}</Text>
          <Text style={styles.beforeLineNumber}>{cell.number ?? ""}</Text>
        </>
      ) : (
        <>
          <Text style={styles.afterLineNumber}>{cell.number ?? ""}</Text>
          <Text selectable style={[styles.codeText, styles.afterCode]}>{cell.text}</Text>
        </>
      )}
    </View>
  );
}

function ChangePane({ cells, side, width, tone, showMarker, onContentLayout }: { cells: DiffCell[]; side: "before" | "after"; width: number; tone: keyof typeof changeColors; showMarker: boolean; onContentLayout: (height: number) => void }) {
  return (
    <View style={[styles.changePane, cells.length === 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: edgeColors[tone] }, { width }]}>
      <View onLayout={(event) => onContentLayout(event.nativeEvent.layout.height)}>
        {cells.map((cell, index) => <CodeLine key={index} cell={cell} side={side} tone={tone} />)}
      </View>
      <View style={styles.changeSpacer}>
        {showMarker ? <View style={[styles.changeMarker, side === "before" ? styles.beforeMarker : styles.afterMarker, { backgroundColor: edgeColors[tone] }]} /> : null}
      </View>
    </View>
  );
}

function ChangeBlock({ before, after, leftWidth, rightWidth, tone }: { before: DiffCell[]; after: DiffCell[]; leftWidth: number; rightWidth: number; tone: keyof typeof changeColors }) {
  const [heights, setHeights] = useState<[number, number]>([0, 0]);
  const setHeight = (side: 0 | 1, height: number) => setHeights((current) => current[side] === height ? current : side === 0 ? [height, current[1]] : [current[0], height]);
  return (
    <View style={styles.changeBlock}>
      <ChangePane side="before" cells={before} width={leftWidth} tone={tone} showMarker={heights[0] < heights[1]} onContentLayout={(height) => setHeight(0, height)} />
      <ChangePane side="after" cells={after} width={rightWidth} tone={tone} showMarker={heights[1] < heights[0]} onContentLayout={(height) => setHeight(1, height)} />
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
          ) : row.kind === "context" ? (
            <View key={index} style={styles.codeRow}>
              <View style={{ width: leftWidth }}><CodeLine side="before" cell={row.before} /></View>
              <View style={{ width: rightWidth }}><CodeLine side="after" cell={row.after} /></View>
            </View>
          ) : (
            <ChangeBlock key={index} before={row.before} after={row.after} leftWidth={leftWidth} rightWidth={rightWidth} tone={row.tone} />
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
  changeBlock: { flexDirection: "row", alignItems: "stretch" },
  changePane: { backgroundColor: "#fff" },
  changeSpacer: { flexGrow: 1, minHeight: 0 },
  changeMarker: { position: "absolute", top: 0, bottom: 0, width: 3 },
  beforeMarker: { right: 0 },
  afterMarker: { left: 0 },
  cell: { flexDirection: "row", minHeight: 22 },
  contextCell: { backgroundColor: "#fff" },
  beforeLineNumber: { width: 38, paddingRight: 7, paddingTop: 3, color: "#94a3b8", textAlign: "right", fontFamily: "monospace", fontSize: 10 },
  afterLineNumber: { width: 38, paddingLeft: 7, paddingTop: 3, color: "#94a3b8", textAlign: "left", fontFamily: "monospace", fontSize: 10 },
  codeText: { flex: 1, paddingHorizontal: 9, paddingVertical: 3, color: "#263445", fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
  beforeCode: { textAlign: "right" },
  afterCode: { textAlign: "left" },
  divider: { position: "absolute", top: 0, bottom: 0, width: DIVIDER_WIDTH, alignItems: "center", justifyContent: "center", cursor: "col-resize" as ViewStyle["cursor"] },
  dividerLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(71,85,105,0.28)" },
});
