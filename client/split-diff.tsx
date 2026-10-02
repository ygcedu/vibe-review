import { useMemo, useRef, useState, type RefObject } from "react";
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type PointerEvent as RNPointerEvent, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { lightHighlightColors, type HighlightToken } from "@getpaseo/highlight";
import type { DiffCell, DiffFile, SplitDiffRow } from "./diff";
import { buildSplitDiffRows } from "./diff";
import { highlightSplitRows } from "./syntax";

const DIVIDER_WIDTH = 14;
const LINE_NUMBER_WIDTH = 38;
const CODE_PADDING = 18;
const changeColors = { modify: "#dceaff", add: "#e3f5e9", remove: "#ffe7e7" } as const;
const edgeColors = { modify: "#a9c9ee", add: "#a7dcb5", remove: "#efb4b4" } as const;

function clampRatio(ratio: number, width: number): number {
  const minRatio = Math.min(0.35, 160 / Math.max(width, 1));
  return Math.max(minRatio, Math.min(1 - minRatio, ratio));
}

function CodeLine({ cell, side, tone, tokens, wrapLines, showLineNumber = true, visibleCodeWidth }: { cell: DiffCell; side: "before" | "after"; tone?: keyof typeof changeColors; tokens?: HighlightToken[]; wrapLines: boolean; showLineNumber?: boolean; visibleCodeWidth?: number }) {
  const code = tokens?.length ? tokens.map((token, index) => <Text key={index} style={{ fontFamily: "monospace", color: token.style ? lightHighlightColors[token.style] : undefined }}>{token.text.replace(/\t/g, "    ")}</Text>) : cell.text.replace(/\t/g, "    ");
  const wrapStyle = Platform.OS === "web" ? ({ whiteSpace: wrapLines ? "pre-wrap" : "pre", fontFamily: "monospace" } as unknown as TextStyle) : undefined;
  const longBeforeLine = visibleCodeWidth !== undefined && cell.text.replace(/\t/g, "    ").length * 6.05 + CODE_PADDING > visibleCodeWidth;
  const beforeNoWrapStyle = side === "before" && visibleCodeWidth !== undefined ? { flexShrink: 0, width: longBeforeLine ? undefined : visibleCodeWidth, textAlign: longBeforeLine ? "left" as const : "right" as const } : { flex: 1 };
  return (
    <View style={[styles.cell, tone ? { backgroundColor: changeColors[tone] } : styles.contextCell, visibleCodeWidth !== undefined && { width: "100%" }]}>
      {side === "before" ? (
        <>
          <Text selectable style={[styles.codeText, styles.beforeCode, wrapStyle, beforeNoWrapStyle]}>{code}</Text>
          {showLineNumber ? <Text style={styles.beforeLineNumber}>{cell.number ?? ""}</Text> : null}
        </>
      ) : (
        <>
          {showLineNumber ? <Text style={styles.afterLineNumber}>{cell.number ?? ""}</Text> : null}
          <Text selectable style={[styles.codeText, styles.afterCode, { flex: 1 }, wrapStyle]}>{code}</Text>
        </>
      )}
    </View>
  );
}

function ChangePane({ cells, side, width, tone, tokens, wrapLines, showMarker, onContentLayout, fixedHeight, showLineNumber = true, visibleCodeWidth }: { cells: DiffCell[]; side: "before" | "after"; width: number; tone: keyof typeof changeColors; tokens: Map<DiffCell, HighlightToken[]>; wrapLines: boolean; showMarker: boolean; onContentLayout: (height: number) => void; fixedHeight?: number; showLineNumber?: boolean; visibleCodeWidth?: number }) {
  return (
    <View style={[styles.changePane, cells.length === 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: edgeColors[tone] }, { width, height: fixedHeight }]}>
      <View onLayout={(event) => onContentLayout(event.nativeEvent.layout.height)}>
        {cells.map((cell, index) => <CodeLine key={index} cell={cell} side={side} tone={tone} tokens={tokens.get(cell)} wrapLines={wrapLines} showLineNumber={showLineNumber} visibleCodeWidth={visibleCodeWidth} />)}
      </View>
      <View style={styles.changeSpacer}>
        {showMarker ? <View style={[styles.changeMarker, side === "before" ? styles.beforeMarker : styles.afterMarker, { backgroundColor: edgeColors[tone] }]} /> : null}
      </View>
    </View>
  );
}

function ChangeBlock({ before, after, leftWidth, rightWidth, tone, tokens, wrapLines }: { before: DiffCell[]; after: DiffCell[]; leftWidth: number; rightWidth: number; tone: keyof typeof changeColors; tokens: Map<DiffCell, HighlightToken[]>; wrapLines: boolean }) {
  const [heights, setHeights] = useState<[number, number]>([0, 0]);
  const setHeight = (side: 0 | 1, height: number) => setHeights((current) => current[side] === height ? current : side === 0 ? [height, current[1]] : [current[0], height]);
  return (
    <View style={styles.changeBlock}>
      <ChangePane side="before" cells={before} width={leftWidth} tone={tone} tokens={tokens} wrapLines={wrapLines} showMarker={heights[0] < heights[1]} onContentLayout={(height) => setHeight(0, height)} />
      <ChangePane side="after" cells={after} width={rightWidth} tone={tone} tokens={tokens} wrapLines={wrapLines} showMarker={heights[1] < heights[0]} onContentLayout={(height) => setHeight(1, height)} />
    </View>
  );
}

function NoWrapGutter({ rows, side }: { rows: SplitDiffRow[]; side: "before" | "after" }) {
  return <View style={styles.lineNumberGutter}>
    {rows.map((row, index) => row.kind === "header" ? (
      <View key={index} style={[styles.hunkRow, styles.noWrapHunkRow]} />
    ) : row.kind === "context" ? (
      <View key={index} style={styles.gutterLine}><Text style={side === "before" ? styles.beforeLineNumber : styles.afterLineNumber}>{row[side].number ?? ""}</Text></View>
    ) : (
      <View key={index} style={{ height: Math.max(row.before.length, row.after.length) * 22 }}>
        {row[side].map((cell, cellIndex) => <View key={cellIndex} style={[styles.gutterLine, { backgroundColor: changeColors[row.tone] }]}><Text style={side === "before" ? styles.beforeLineNumber : styles.afterLineNumber}>{cell.number ?? ""}</Text></View>)}
        {row[side].length < Math.max(row.before.length, row.after.length) ? (
          <View style={[styles.gutterMarker, side === "before" ? styles.beforeMarker : styles.afterMarker, { top: row[side].length * 22, backgroundColor: edgeColors[row.tone] }]} />
        ) : null}
        {row[side].length === 0 ? <View style={[styles.gutterTopEdge, { backgroundColor: edgeColors[row.tone] }]} /> : null}
      </View>
    ))}
  </View>;
}

function NoWrapPane({ rows, side, width, contentWidth, tokens, scrollRef, onScroll }: { rows: SplitDiffRow[]; side: "before" | "after"; width: number; contentWidth: number; tokens: Map<DiffCell, HighlightToken[]>; scrollRef: RefObject<ScrollView | null>; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const code = <ScrollView horizontal showsHorizontalScrollIndicator={false} ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={{ width: width - LINE_NUMBER_WIDTH }}>
      <View style={{ width: contentWidth }}>
        {rows.map((row, index) => row.kind === "header" ? (
          <View key={index} style={[styles.hunkRow, styles.noWrapHunkRow]}><Text numberOfLines={1} style={styles.hunkText}>{row.label}</Text></View>
        ) : row.kind === "context" ? (
          <CodeLine key={index} side={side} cell={row[side]} tokens={tokens.get(row[side])} wrapLines={false} showLineNumber={false} visibleCodeWidth={width - LINE_NUMBER_WIDTH} />
        ) : (
          <ChangePane
            key={index}
            cells={row[side]}
            side={side}
            width={contentWidth}
            tone={row.tone}
            tokens={tokens}
            wrapLines={false}
            showLineNumber={false}
            visibleCodeWidth={width - LINE_NUMBER_WIDTH}
            showMarker={false}
            onContentLayout={() => {}}
            fixedHeight={Math.max(row.before.length, row.after.length) * 22}
          />
        ))}
      </View>
  </ScrollView>;
  const gutter = <NoWrapGutter rows={rows} side={side} />;
  return <View style={[styles.codeRow, { width }]}>{side === "before" ? <>{code}{gutter}</> : <>{gutter}{code}</>}</View>;
}

/** Two aligned panes modeled after an IDE side-by-side diff. */
export function SplitDiff({ file }: { file: DiffFile }) {
  const rows = useMemo(() => buildSplitDiffRows(file.lines), [file.lines]);
  const tokens = useMemo(() => highlightSplitRows(rows, file.path), [rows, file.path]);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(0.5);
  const [wrapLines, setWrapLines] = useState(true);
  const [showWrapTooltip, setShowWrapTooltip] = useState(false);
  const widthRef = useRef(0);
  const ratioRef = useRef(0.5);
  const dragStartRatio = useRef(0.5);
  const webDrag = useRef<{ startX: number; startRatio: number } | null>(null);
  const beforeScroll = useRef<ScrollView>(null);
  const afterScroll = useRef<ScrollView>(null);
  const beforeFooter = useRef<ScrollView>(null);
  const afterFooter = useRef<ScrollView>(null);
  const horizontalPositions = useRef({ before: 0, after: 0 });
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
  const minCodeWidths = useMemo(() => {
    let before = 0;
    let after = 0;
    const canvas = Platform.OS === "web" && typeof document !== "undefined" ? document.createElement("canvas") : null;
    const context = canvas?.getContext("2d");
    if (context) context.font = "10px monospace";
    const measure = (cell: DiffCell, side: "before" | "after") => {
      const expanded = cell.text.replace(/\t/g, "    ");
      const fallbackColumns = [...expanded].reduce((total, char) => total + (char.codePointAt(0)! > 0x2e80 ? 1.7 : 1), 0);
      const pixels = (context?.measureText(expanded).width ?? fallbackColumns * 6.05) + CODE_PADDING;
      if (side === "before") before = Math.max(before, pixels);
      else after = Math.max(after, pixels);
    };
    for (const row of rows) {
      if (row.kind === "context") { measure(row.before, "before"); measure(row.after, "after"); }
      if (row.kind === "change") {
        row.before.forEach((cell) => measure(cell, "before"));
        row.after.forEach((cell) => measure(cell, "after"));
      }
    }
    return { before, after };
  }, [rows]);
  const baseLeftWidth = Math.round(width * clampRatio(ratio, width));
  const leftWidth = baseLeftWidth;
  const rightWidth = width - baseLeftWidth;
  const beforeMaxScroll = Math.max(0, minCodeWidths.before - (leftWidth - LINE_NUMBER_WIDTH));
  const afterMaxScroll = Math.max(0, minCodeWidths.after - (rightWidth - LINE_NUMBER_WIDTH));
  const syncScroll = (side: "before" | "after", event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const targetSide = side === "before" ? "after" : "before";
    const previousX = horizontalPositions.current[side];
    const sourceX = event.nativeEvent.contentOffset.x;
    horizontalPositions.current[side] = sourceX;
    if (Math.abs(sourceX - previousX) < 0.01) return;
    (side === "before" ? beforeScroll : afterScroll).current?.scrollTo({ x: sourceX, animated: false });
    (side === "before" ? beforeFooter : afterFooter).current?.scrollTo({ x: sourceX, animated: false });
    // Keep the same physical scroll offset on both sides. A shorter side stops
    // at its own end while the longer side can continue and return independently.
    const targetMax = side === "before" ? afterMaxScroll : beforeMaxScroll;
    const targetX = Math.max(0, Math.min(targetMax, sourceX));
    if (Math.abs(horizontalPositions.current[targetSide] - targetX) < 0.01) return;
    horizontalPositions.current[targetSide] = targetX;
    (side === "before" ? afterScroll : beforeScroll).current?.scrollTo({ x: targetX, animated: false });
    (side === "before" ? afterFooter : beforeFooter).current?.scrollTo({ x: targetX, animated: false });
  };
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
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="折行显示"
          aria-pressed={wrapLines}
          onHoverIn={() => setShowWrapTooltip(true)}
          onHoverOut={() => setShowWrapTooltip(false)}
          onPress={() => setWrapLines((current) => !current)}
          style={[styles.toolbarButton, wrapLines && styles.toolbarButtonActive]}
        >
          <Icon name="WrapText" size={17} color={wrapLines ? "#2563eb" : "#64748b"} />
        </Pressable>
        {showWrapTooltip ? <View style={styles.tooltip}><Text style={styles.tooltipText}>折行显示</Text></View> : null}
      </View>
      {width > 0 ? wrapLines ? <ScrollView style={styles.verticalScroll} nestedScrollEnabled>
        <View style={[styles.table, { width }]}>
          {rows.map((row, index) => row.kind === "header" ? (
            <View key={index} style={styles.hunkRow}>
              <Text style={styles.hunkText}>{row.label}</Text>
            </View>
          ) : row.kind === "context" ? (
            <View key={index} style={styles.codeRow}>
              <View style={{ width: leftWidth }}><CodeLine side="before" cell={row.before} tokens={tokens.get(row.before)} wrapLines={wrapLines} /></View>
              <View style={{ width: rightWidth }}><CodeLine side="after" cell={row.after} tokens={tokens.get(row.after)} wrapLines={wrapLines} /></View>
            </View>
          ) : (
            <ChangeBlock key={index} before={row.before} after={row.after} leftWidth={leftWidth} rightWidth={rightWidth} tone={row.tone} tokens={tokens} wrapLines={wrapLines} />
          ))}
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
        </View>
      </ScrollView> : <View style={styles.noWrapPanes}>
        <ScrollView style={styles.verticalScroll} nestedScrollEnabled>
        <View style={[styles.codeRow, { width }]}>
          <NoWrapPane rows={rows} side="before" width={leftWidth} contentWidth={Math.max(leftWidth - LINE_NUMBER_WIDTH, minCodeWidths.before)} tokens={tokens} scrollRef={beforeScroll} onScroll={(event) => syncScroll("before", event)} />
          <NoWrapPane rows={rows} side="after" width={rightWidth} contentWidth={Math.max(rightWidth - LINE_NUMBER_WIDTH, minCodeWidths.after)} tokens={tokens} scrollRef={afterScroll} onScroll={(event) => syncScroll("after", event)} />
        </View>
        </ScrollView>
        <View style={[styles.codeRow, { width }]}>
          <View style={{ width: leftWidth - LINE_NUMBER_WIDTH }}>
            <ScrollView horizontal ref={beforeFooter} onScroll={(event) => syncScroll("before", event)} scrollEventThrottle={16} style={styles.footerScroll}><View style={{ width: Math.max(leftWidth - LINE_NUMBER_WIDTH, minCodeWidths.before), height: 1 }} /></ScrollView>
          </View>
          <View style={{ width: LINE_NUMBER_WIDTH }} />
          <View style={{ width: LINE_NUMBER_WIDTH }} />
          <View style={{ width: rightWidth - LINE_NUMBER_WIDTH }}>
            <ScrollView horizontal ref={afterFooter} onScroll={(event) => syncScroll("after", event)} scrollEventThrottle={16} style={styles.footerScroll}><View style={{ width: Math.max(rightWidth - LINE_NUMBER_WIDTH, minCodeWidths.after), height: 1 }} /></ScrollView>
          </View>
        </View>
      </View> : null}
      {width > 0 && !wrapLines ? (
        <View {...webPointerHandlers} accessibilityRole="adjustable" accessibilityLabel="调整左右对照宽度" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }} style={[styles.divider, { top: 38, left: leftWidth - DIVIDER_WIDTH / 2 }]}>
          <View style={styles.dividerLine} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { position: "relative", minHeight: 32 },
  toolbar: { height: 38, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderBottomWidth: 1, borderBottomColor: "#d7dee8", zIndex: 2 },
  toolbarButton: { width: 28, height: 28, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  toolbarButtonActive: { backgroundColor: "#dbeafe" },
  tooltip: { position: "absolute", top: 35, left: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 5, backgroundColor: "#1e293b" },
  tooltipText: { color: "#fff", fontSize: 11 },
  verticalScroll: { maxHeight: 520 },
  noWrapPanes: { maxHeight: 538 },
  footerScroll: { height: 18, backgroundColor: "#f8fafc" },
  noWrapHunkRow: { height: 24 },
  lineNumberGutter: { width: LINE_NUMBER_WIDTH, backgroundColor: "#fff" },
  gutterLine: { height: 22, width: LINE_NUMBER_WIDTH },
  table: { backgroundColor: "#fff" },
  hunkRow: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: "#e9f0fb", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#cbdaf4" },
  hunkText: { color: "#4b6287", fontFamily: "monospace", fontSize: 10 },
  codeRow: { flexDirection: "row", alignItems: "stretch" },
  changeBlock: { flexDirection: "row", alignItems: "stretch" },
  changePane: { backgroundColor: "#fff" },
  changeSpacer: { flexGrow: 1, minHeight: 0 },
  changeMarker: { position: "absolute", top: 0, bottom: 0, width: 3 },
  gutterMarker: { position: "absolute", bottom: 0, width: 3 },
  gutterTopEdge: { position: "absolute", top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  beforeMarker: { right: 0 },
  afterMarker: { left: 0 },
  cell: { flexDirection: "row", minHeight: 22 },
  contextCell: { backgroundColor: "#fff" },
  beforeLineNumber: { width: 38, paddingRight: 7, paddingTop: 3, color: "#94a3b8", textAlign: "right", fontFamily: "monospace", fontSize: 10 },
  afterLineNumber: { width: 38, paddingLeft: 7, paddingTop: 3, color: "#94a3b8", textAlign: "left", fontFamily: "monospace", fontSize: 10 },
  codeText: { paddingHorizontal: 9, paddingVertical: 3, color: "#263445", fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
  beforeCode: { textAlign: "right" },
  afterCode: { textAlign: "left" },
  divider: { position: "absolute", top: 0, bottom: 0, width: DIVIDER_WIDTH, alignItems: "center", justifyContent: "center", cursor: "col-resize" as ViewStyle["cursor"] },
  dividerLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(71,85,105,0.28)" },
});
