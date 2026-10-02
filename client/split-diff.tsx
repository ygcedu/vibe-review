import { useMemo, useRef, useState, type RefObject } from "react";
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type PointerEvent as RNPointerEvent, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { lightHighlightColors, type HighlightToken } from "@getpaseo/highlight";
import type { DiffCell, DiffFile, PaneRow } from "./diff";
import { buildPaneRows, buildSplitDiffRows } from "./diff";
import { highlightSplitRows } from "./syntax";

const DIVIDER_WIDTH = 14;
const LINE_NUMBER_WIDTH = 38;
const CODE_PADDING = 18;
const CONNECTOR_WIDTH = 20;
const WAVE_HEIGHT = 12;
const WAVE_PERIOD = 16;
const WAVE_COLOR = "#cbd5e1";
const changeColors = { modify: "#dceaff", add: "#e3f5e9", remove: "#ffe7e7" } as const;

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

const waveTile = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0 0 16 12"><path d="M0 6 C4 1 4 1 8 6 S12 11 16 6" fill="none" stroke="${WAVE_COLOR}" stroke-width="1"/></svg>`)}")`;

function Wave({ width, side, onLayout }: { width: number; side: "before" | "after"; onLayout?: (top: number, height: number) => void }) {
  const webStyle = Platform.OS === "web" ? ({ backgroundImage: waveTile, backgroundRepeat: "repeat-x", backgroundPositionX: side === "before" ? width % WAVE_PERIOD : 0 } as unknown as ViewStyle) : undefined;
  return <View onLayout={onLayout ? (event) => onLayout(event.nativeEvent.layout.y, event.nativeEvent.layout.height) : undefined} style={[styles.wave, { width }, webStyle]}>{Platform.OS !== "web" ? <Text numberOfLines={1} style={styles.waveText}>{"∿".repeat(Math.max(12, Math.ceil(width / 7)))}</Text> : null}</View>;
}

type Bounds = { top: number; bottom: number };
type ChangeBounds = Record<number, { before?: Bounds; after?: Bounds }>;
type RecordChange = (side: "before" | "after", index: number, top: number, height: number) => void;
type WaveBounds = Record<number, { before?: Bounds; after?: Bounds }>;

function waveConnectorImage(beforeY: number, afterY: number, height: number): string {
  const span = CONNECTOR_WIDTH;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${span}" height="${height}" viewBox="0 0 ${span} ${height}"><path d="M0 ${beforeY} L${span} ${afterY}" fill="none" stroke="${WAVE_COLOR}" stroke-width="1"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function WrapPane({ rows, side, width, tokens, onChange, onWave }: { rows: PaneRow[]; side: "before" | "after"; width: number; tokens: Map<DiffCell, HighlightToken[]>; onChange: RecordChange; onWave: RecordChange }) {
  return <View style={{ width }}>
    {rows.map((row) => row.kind === "wave" ? <Wave key={row.key} width={width} side={side} onLayout={(top, height) => onWave(side, row.index, top, height)} /> : row.kind === "code" ? (
      <CodeLine key={row.key} side={side} cell={row.cell} tokens={tokens.get(row.cell)} wrapLines />
    ) : <View key={row.key} onLayout={(event) => onChange(side, row.index, event.nativeEvent.layout.y, event.nativeEvent.layout.height)}>
      {row.cells.length ? row.cells.map((cell, index) => <CodeLine key={index} side={side} cell={cell} tone={row.tone} tokens={tokens.get(cell)} wrapLines />) : <View style={[styles.emptyChange, { backgroundColor: changeColors[row.tone] }]} />}
    </View>)}
  </View>;
}

function NoWrapGutter({ rows, side, onChange, onWave }: { rows: PaneRow[]; side: "before" | "after"; onChange: RecordChange; onWave: RecordChange }) {
  return <View style={styles.lineNumberGutter}>
    {rows.map((row) => row.kind === "wave" ? <View key={row.key} style={{ height: WAVE_HEIGHT }} onLayout={(event) => onWave(side, row.index, event.nativeEvent.layout.y, event.nativeEvent.layout.height)} /> : row.kind === "code" ? (
      <View key={row.key} style={styles.gutterLine}><Text style={side === "before" ? styles.beforeLineNumber : styles.afterLineNumber}>{row.cell.number ?? ""}</Text></View>
    ) : (
      <View key={row.key} onLayout={(event) => onChange(side, row.index, event.nativeEvent.layout.y, event.nativeEvent.layout.height)}>
        {row.cells.length ? row.cells.map((cell, index) => <View key={index} style={[styles.gutterLine, { backgroundColor: changeColors[row.tone] }]}><Text style={side === "before" ? styles.beforeLineNumber : styles.afterLineNumber}>{cell.number ?? ""}</Text></View>) : <View style={[styles.emptyChange, { backgroundColor: changeColors[row.tone] }]} />}
      </View>
    ))}
  </View>;
}

function NoWrapPane({ rows, side, width, contentWidth, tokens, scrollRef, onScroll, onChange, onWave, waveBounds }: { rows: PaneRow[]; side: "before" | "after"; width: number; contentWidth: number; tokens: Map<DiffCell, HighlightToken[]>; scrollRef: RefObject<ScrollView | null>; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void; onChange: RecordChange; onWave: RecordChange; waveBounds: WaveBounds }) {
  const code = <ScrollView horizontal showsHorizontalScrollIndicator={false} ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={{ width: width - LINE_NUMBER_WIDTH }}>
      <View style={{ width: contentWidth }}>
        {rows.map((row) => row.kind === "wave" ? <View key={row.key} style={{ height: WAVE_HEIGHT }} /> : row.kind === "code" ? (
          <CodeLine key={row.key} side={side} cell={row.cell} tokens={tokens.get(row.cell)} wrapLines={false} showLineNumber={false} visibleCodeWidth={width - LINE_NUMBER_WIDTH} />
        ) : (
          <View key={row.key}>
            {row.cells.length ? row.cells.map((cell, index) => <CodeLine key={index} side={side} cell={cell} tone={row.tone} tokens={tokens.get(cell)} wrapLines={false} showLineNumber={false} visibleCodeWidth={width - LINE_NUMBER_WIDTH} />) : <View style={[styles.emptyChange, { backgroundColor: changeColors[row.tone] }]} />}
          </View>
        ))}
      </View>
  </ScrollView>;
  const gutter = <NoWrapGutter rows={rows} side={side} onChange={onChange} onWave={onWave} />;
  return <View style={[styles.codeRow, { width, position: "relative" }]}>
    {side === "before" ? <>{code}{gutter}</> : <>{gutter}{code}</>}
    {rows.filter((row) => row.kind === "wave").map((row) => {
      if (row.kind !== "wave") return null;
      const bounds = waveBounds[row.index]?.[side];
      return bounds ? <View key={row.key} pointerEvents="none" style={{ position: "absolute", top: bounds.top, left: 0, zIndex: 1 }}><Wave width={width} side={side} /></View> : null;
    })}
  </View>;
}

function Connector({ rows, bounds, waveBounds }: { rows: PaneRow[]; bounds: ChangeBounds; waveBounds: WaveBounds }) {
  return <View style={styles.connector}>
    {rows.filter((row) => row.kind === "change").map((row) => {
      if (row.kind !== "change") return null;
      const pair = bounds[row.index];
      if (!pair?.before || !pair.after) return null;
      const top = Math.min(pair.before.top, pair.after.top);
      const bottom = Math.max(pair.before.bottom, pair.after.bottom);
      const polygon = `polygon(0 ${pair.before.top - top}px, 100% ${pair.after.top - top}px, 100% ${pair.after.bottom - top}px, 0 ${pair.before.bottom - top}px)`;
      return <View key={row.key} style={[styles.connectorChange, { top, height: Math.max(1, bottom - top), backgroundColor: changeColors[row.tone] }, Platform.OS === "web" && ({ clipPath: polygon } as unknown as ViewStyle)]} />;
    })}
    {rows.filter((row) => row.kind === "wave").map((row) => {
      if (row.kind !== "wave") return null;
      const pair = waveBounds[row.index];
      if (!pair?.before || !pair.after || Platform.OS !== "web") return null;
      const top = Math.min(pair.before.top, pair.after.top);
      const height = Math.ceil(Math.max(pair.before.bottom, pair.after.bottom) - top);
      const beforeY = pair.before.top + WAVE_HEIGHT / 2 - top;
      const afterY = pair.after.top + WAVE_HEIGHT / 2 - top;
      return <View key={row.key} style={[styles.connectorWave, { top, height, backgroundImage: waveConnectorImage(beforeY, afterY, height) } as unknown as ViewStyle]} />;
    })}
    <View style={styles.connectorLine} />
  </View>;
}

/** Two aligned panes modeled after an IDE side-by-side diff. */
export function SplitDiff({ file }: { file: DiffFile }) {
  const rows = useMemo(() => buildSplitDiffRows(file.lines), [file.lines]);
  const beforeRows = useMemo(() => buildPaneRows(rows, "before"), [rows]);
  const afterRows = useMemo(() => buildPaneRows(rows, "after"), [rows]);
  const tokens = useMemo(() => highlightSplitRows(rows, file.path), [rows, file.path]);
  const [changeBounds, setChangeBounds] = useState<ChangeBounds>({});
  const [waveBounds, setWaveBounds] = useState<WaveBounds>({});
  const onChange: RecordChange = (side, index, top, height) => setChangeBounds((current) => {
    const nextBounds = { top, bottom: top + height };
    const previous = current[index]?.[side];
    if (previous?.top === nextBounds.top && previous.bottom === nextBounds.bottom) return current;
    return { ...current, [index]: { ...current[index], [side]: nextBounds } };
  });
  const onWave: RecordChange = (side, index, top, height) => setWaveBounds((current) => {
    const nextBounds = { top, bottom: top + height };
    const previous = current[index]?.[side];
    if (previous?.top === nextBounds.top && previous.bottom === nextBounds.bottom) return current;
    return { ...current, [index]: { ...current[index], [side]: nextBounds } };
  });
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
  const paneWidth = Math.max(0, width - CONNECTOR_WIDTH);
  const baseLeftWidth = Math.round(paneWidth * clampRatio(ratio, paneWidth));
  const leftWidth = baseLeftWidth;
  const rightWidth = paneWidth - baseLeftWidth;
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
        <View style={[styles.table, styles.codeRow, { width }]}>
          <WrapPane rows={beforeRows} side="before" width={leftWidth} tokens={tokens} onChange={onChange} onWave={onWave} />
          <Connector rows={beforeRows} bounds={changeBounds} waveBounds={waveBounds} />
          <WrapPane rows={afterRows} side="after" width={rightWidth} tokens={tokens} onChange={onChange} onWave={onWave} />
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
            style={[styles.divider, { left: leftWidth + CONNECTOR_WIDTH / 2 - DIVIDER_WIDTH / 2 }]}
          >
            <View style={styles.dividerLine} />
          </View>
        </View>
      </ScrollView> : <View style={styles.noWrapPanes}>
        <ScrollView style={styles.verticalScroll} nestedScrollEnabled>
        <View style={[styles.codeRow, { width }]}>
          <NoWrapPane rows={beforeRows} side="before" width={leftWidth} contentWidth={Math.max(leftWidth - LINE_NUMBER_WIDTH, minCodeWidths.before)} tokens={tokens} scrollRef={beforeScroll} onScroll={(event) => syncScroll("before", event)} onChange={onChange} onWave={onWave} waveBounds={waveBounds} />
          <Connector rows={beforeRows} bounds={changeBounds} waveBounds={waveBounds} />
          <NoWrapPane rows={afterRows} side="after" width={rightWidth} contentWidth={Math.max(rightWidth - LINE_NUMBER_WIDTH, minCodeWidths.after)} tokens={tokens} scrollRef={afterScroll} onScroll={(event) => syncScroll("after", event)} onChange={onChange} onWave={onWave} waveBounds={waveBounds} />
        </View>
        </ScrollView>
        <View style={[styles.codeRow, { width }]}>
          <View style={{ width: leftWidth - LINE_NUMBER_WIDTH }}>
            <ScrollView horizontal ref={beforeFooter} onScroll={(event) => syncScroll("before", event)} scrollEventThrottle={16} style={styles.footerScroll}><View style={{ width: Math.max(leftWidth - LINE_NUMBER_WIDTH, minCodeWidths.before), height: 1 }} /></ScrollView>
          </View>
          <View style={{ width: LINE_NUMBER_WIDTH + CONNECTOR_WIDTH }} />
          <View style={{ width: LINE_NUMBER_WIDTH }} />
          <View style={{ width: rightWidth - LINE_NUMBER_WIDTH }}>
            <ScrollView horizontal ref={afterFooter} onScroll={(event) => syncScroll("after", event)} scrollEventThrottle={16} style={styles.footerScroll}><View style={{ width: Math.max(rightWidth - LINE_NUMBER_WIDTH, minCodeWidths.after), height: 1 }} /></ScrollView>
          </View>
        </View>
      </View> : null}
      {width > 0 && !wrapLines ? (
        <View {...webPointerHandlers} accessibilityRole="adjustable" accessibilityLabel="调整左右对照宽度" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }} style={[styles.divider, { top: 38, left: leftWidth + CONNECTOR_WIDTH / 2 - DIVIDER_WIDTH / 2 }]}>
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
  lineNumberGutter: { width: LINE_NUMBER_WIDTH, backgroundColor: "#fff" },
  gutterLine: { height: 22, width: LINE_NUMBER_WIDTH },
  table: { backgroundColor: "#fff" },
  wave: { height: WAVE_HEIGHT, overflow: "hidden", justifyContent: "center", backgroundColor: "#fff" },
  waveText: { color: "#cbd5e1", fontSize: 13, lineHeight: WAVE_HEIGHT, letterSpacing: 1, marginTop: -2 },
  emptyChange: { height: 1 },
  connector: { width: CONNECTOR_WIDTH, alignSelf: "stretch", backgroundColor: "#fff", position: "relative" },
  connectorChange: { position: "absolute", left: 0, right: 0 },
  connectorWave: { position: "absolute", left: 0, width: CONNECTOR_WIDTH, zIndex: 2, pointerEvents: "none" },
  connectorLine: { position: "absolute", top: 0, bottom: 0, left: CONNECTOR_WIDTH / 2, width: 1, backgroundColor: "rgba(71,85,105,0.18)" },
  codeRow: { flexDirection: "row", alignItems: "stretch" },
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
