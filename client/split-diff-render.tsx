import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle, type ViewStyle } from "react-native";
import type { RefObject } from "react";
import type { HighlightToken } from "@getpaseo/highlight";
import type { DiffCell, PaneRow } from "./diff";
import type { TextSpan } from "./intraline";
import { bottomFalling, bottomRising, topFalling, topRising } from "./connector-masks";

export const LINE_NUMBER_WIDTH = 38;
export const CODE_PADDING = 18;
export const CONNECTOR_WIDTH = 20;
const WAVE_HEIGHT = 12;
const WAVE_PERIOD = 16;
const WAVE_COLOR = "#cbd5e1";
const nativeWaveTile = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAjUlEQVR4nGNgoCY4e/2hFAiTrPH///9Mp64+6Dt99eFzEAaxQWJEG3D6ysPu01ceHDx//r4ACIPYIDGiNJ+68ijx1NUHd87ceCoCEzt25ZHQ6SsPbp6+8jCdsO1XH744ee2JGro4SAwkd+byfUdcesHhdRZPoIE0E7KAgeZeZKA0kEGA4miGAbITGj4AAMQGmf03ekjFAAAAAElFTkSuQmCC";
const changeColors = { modify: "#dceaff", add: "#e3f5e9", remove: "#ffe7e7" } as const;
const changedTextColors = { before: "#c8cdd4", after: "#b8e6c4" } as const;
// Match @getpaseo/highlight's light palette without eagerly loading its parsers.
const lightHighlightColors: Record<NonNullable<HighlightToken["style"]>, string> = {
  keyword: "#cf222e", comment: "#6e7781", string: "#0a3069",
  number: "#0550ae", literal: "#0550ae", function: "#8250df",
  definition: "#8250df", class: "#953800", type: "#cf222e",
  tag: "#116329", attribute: "#0550ae", property: "#0550ae",
  variable: "#24292f", operator: "#0550ae", punctuation: "#24292f",
  regexp: "#0a3069", escape: "#0550ae", meta: "#6e7781",
  heading: "#0550ae", link: "#0a3069",
};

function CodeLine({ cell, side, tone, tokens, changedSpans, wrapLines, showLineNumber = true, visibleCodeWidth }: { cell: DiffCell; side: "before" | "after"; tone?: keyof typeof changeColors; tokens?: HighlightToken[]; changedSpans?: TextSpan[]; wrapLines: boolean; showLineNumber?: boolean; visibleCodeWidth?: number }) {
  const highlighted = tokens?.length && tokens.map((token) => token.text).join("") === cell.text ? tokens : [{ text: cell.text, style: undefined }];
  let offset = 0;
  const code = highlighted.map((token, index) => {
    const start = offset;
    offset += token.text.length;
    const cuts = [start, offset, ...(changedSpans ?? []).flatMap((span) => [span.start, span.end].filter((point) => point > start && point < offset))].sort((a, b) => a - b);
    return cuts.slice(0, -1).map((from, part) => {
      const to = cuts[part + 1];
      const changed = changedSpans?.some((span) => from < span.end && to > span.start);
      return <Text key={`${index}-${part}`} style={{ fontFamily: "monospace", color: token.style ? lightHighlightColors[token.style] : undefined, backgroundColor: changed ? changedTextColors[side] : undefined }}>{token.text.slice(from - start, to - start).replace(/\t/g, "    ")}</Text>;
    });
  });
  const wrapStyle = Platform.OS === "web" ? ({ whiteSpace: wrapLines ? "pre-wrap" : "pre", overflowWrap: wrapLines ? "anywhere" : "normal", fontFamily: "monospace" } as unknown as TextStyle) : undefined;
  return (
    <View style={[styles.cell, tone ? { backgroundColor: changeColors[tone] } : styles.contextCell, visibleCodeWidth !== undefined && { width: "100%", height: 22, overflow: "hidden" }]}>
      {side === "before" ? (
        <>
          <Text selectable allowFontScaling={false} style={[styles.codeText, styles.beforeCode, { flex: 1 }, wrapStyle]}>{code}</Text>
          {showLineNumber ? <Text allowFontScaling={false} style={styles.beforeLineNumber}>{cell.number ?? ""}</Text> : null}
        </>
      ) : (
        <>
          {showLineNumber ? <Text allowFontScaling={false} style={styles.afterLineNumber}>{cell.number ?? ""}</Text> : null}
          <Text selectable allowFontScaling={false} style={[styles.codeText, styles.afterCode, { flex: 1 }, wrapStyle]}>{code}</Text>
        </>
      )}
    </View>
  );
}

const waveTile = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0 0 16 12"><path d="M0 6 C4 1 4 1 8 6 S12 11 16 6" fill="none" stroke="${WAVE_COLOR}" stroke-width="1"/></svg>`)}")`;

function Wave({ width, side, onLayout, onPress }: { width: number; side: "before" | "after"; onLayout?: (top: number, height: number) => void; onPress?: () => void }) {
  const webStyle = Platform.OS === "web" ? ({ backgroundImage: waveTile, backgroundRepeat: "repeat-x", backgroundPositionX: side === "before" ? width % WAVE_PERIOD : 0 } as unknown as ViewStyle) : undefined;
  const nativePhase = side === "before" ? width % WAVE_PERIOD - WAVE_PERIOD : 0;
  return <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={onPress ? "展开省略的代码" : undefined} disabled={!onPress} onPress={onPress} onLayout={onLayout ? (event) => onLayout(event.nativeEvent.layout.y, event.nativeEvent.layout.height) : undefined} style={[styles.wave, { width }, webStyle, !onPress && { cursor: "auto" }]}>{Platform.OS !== "web" ? (
    <View style={{ flexDirection: "row", position: "absolute", left: nativePhase, top: 0 }}>
      {Array.from({ length: Math.ceil((width - nativePhase) / WAVE_PERIOD) }, (_, index) => (
        <Image key={index} source={{ uri: nativeWaveTile }} resizeMode="stretch" style={{ width: WAVE_PERIOD, height: WAVE_HEIGHT }} />
      ))}
    </View>
  ) : null}</Pressable>;
}

export type Bounds = { top: number; bottom: number };
export type ChangeBounds = Record<number, { before?: Bounds; after?: Bounds }>;
export type RecordChange = (side: "before" | "after", index: number, top: number, height: number) => void;
export type WaveBounds = Record<number, { before?: Bounds; after?: Bounds }>;

export function fixedNoWrapHeight(rows: PaneRow[]): number {
  return rows.reduce((height, row) => height + (row.kind === "wave" ? WAVE_HEIGHT : row.kind === "change" ? Math.max(1, row.cells.length * 22) : 22), 0);
}

/** Fixed-height rows let either renderer mount only the visible slice of a long file. */
const rowOffsets = new WeakMap<PaneRow[], number[]>();
export function noWrapWindow(rows: PaneRow[], offset: number, viewportHeight: number) {
  let offsets = rowOffsets.get(rows);
  if (!offsets) {
    offsets = [0];
    for (const row of rows) offsets.push(offsets[offsets.length - 1]! + (row.kind === "wave" ? WAVE_HEIGHT : row.kind === "change" ? Math.max(1, row.cells.length * 22) : 22));
    rowOffsets.set(rows, offsets);
  }
  const upper = Math.max(0, offset - 440);
  const lower = offset + viewportHeight + 440;
  const firstAfter = (height: number) => {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets![mid + 1]! < height) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const start = firstAfter(upper);
  const end = Math.min(rows.length, firstAfter(lower) + 1);
  return { start, end, top: offsets[start]!, bottom: offsets[rows.length]! - offsets[end]! };
}

/** No-wrap rows have fixed heights, so their connector positions need no native layout callbacks. */
export function fixedNoWrapBounds(beforeRows: PaneRow[], afterRows: PaneRow[]): { changes: ChangeBounds; waves: WaveBounds } {
  const changes: ChangeBounds = {};
  const waves: WaveBounds = {};
  for (const [side, rows] of [["before", beforeRows], ["after", afterRows]] as const) {
    let top = 0;
    for (const row of rows) {
      const height = row.kind === "wave" ? WAVE_HEIGHT : row.kind === "change" ? Math.max(1, row.cells.length * 22) : 22;
      if (row.kind !== "code") {
        const target = row.kind === "wave" ? waves : changes;
        target[row.index] = { ...target[row.index], [side]: { top, bottom: top + height } };
      }
      top += height;
    }
  }
  return { changes, waves };
}

export function WrapPane({ rows, side, width, tokens, changedSpans, onChange, onWave, onExpandWave }: { rows: PaneRow[]; side: "before" | "after"; width: number; tokens: Map<DiffCell, HighlightToken[]>; changedSpans: Map<DiffCell, TextSpan[]>; onChange: RecordChange; onWave: RecordChange; onExpandWave?: (index: number) => void }) {
  return <View style={{ width }}>
    {rows.map((row) => row.kind === "wave" ? <Wave key={row.key} width={width} side={side} onPress={onExpandWave ? () => onExpandWave(row.index) : undefined} onLayout={(top, height) => onWave(side, row.index, top, height)} /> : row.kind === "code" ? (
      <CodeLine key={row.key} side={side} cell={row.cell} tokens={tokens.get(row.cell)} wrapLines />
    ) : <View key={row.key} onLayout={(event) => onChange(side, row.index, event.nativeEvent.layout.y, event.nativeEvent.layout.height)}>
      {row.cells.length ? row.cells.map((cell, index) => <CodeLine key={index} side={side} cell={cell} tone={row.tone} tokens={tokens.get(cell)} changedSpans={changedSpans.get(cell)} wrapLines />) : <View style={[styles.emptyChange, { backgroundColor: changeColors[row.tone] }]} />}
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

export function NoWrapPane({ rows, side, width, contentWidth, tokens, changedSpans, scrollRef, onScroll, onChange, onWave, waveBounds, onExpandWave, visibleOffset = 0, viewportHeight = 520 }: { rows: PaneRow[]; side: "before" | "after"; width: number; contentWidth: number; tokens: Map<DiffCell, HighlightToken[]>; changedSpans: Map<DiffCell, TextSpan[]>; scrollRef: RefObject<ScrollView | null>; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void; onChange: RecordChange; onWave: RecordChange; waveBounds: WaveBounds; onExpandWave?: (index: number) => void; visibleOffset?: number; viewportHeight?: number }) {
  const virtualized = rows.length > 120;
  const window = virtualized ? noWrapWindow(rows, visibleOffset, viewportHeight) : { start: 0, end: rows.length, top: 0, bottom: 0 };
  const visibleRows = rows.slice(window.start, window.end);
  const code = <ScrollView horizontal nestedScrollEnabled bounces={false} overScrollMode="never" showsHorizontalScrollIndicator={false} ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={{ width: width - LINE_NUMBER_WIDTH }}>
      <View style={{ width: contentWidth }}>
        {window.top > 0 ? <View style={{ height: window.top }} /> : null}
        {visibleRows.map((row) => row.kind === "wave" ? <View key={row.key} style={{ height: WAVE_HEIGHT }} /> : row.kind === "code" ? (
          <CodeLine key={row.key} side={side} cell={row.cell} tokens={tokens.get(row.cell)} wrapLines={false} showLineNumber={false} visibleCodeWidth={width - LINE_NUMBER_WIDTH} />
        ) : (
          <View key={row.key}>
            {row.cells.length ? row.cells.map((cell, index) => <CodeLine key={index} side={side} cell={cell} tone={row.tone} tokens={tokens.get(cell)} changedSpans={changedSpans.get(cell)} wrapLines={false} showLineNumber={false} visibleCodeWidth={width - LINE_NUMBER_WIDTH} />) : <View style={[styles.emptyChange, { backgroundColor: changeColors[row.tone] }]} />}
          </View>
        ))}
        {window.bottom > 0 ? <View style={{ height: window.bottom }} /> : null}
      </View>
  </ScrollView>;
  const gutter = <View style={styles.lineNumberGutter}>{window.top > 0 ? <View style={{ height: window.top }} /> : null}<NoWrapGutter rows={visibleRows} side={side} onChange={virtualized ? () => {} : onChange} onWave={virtualized ? () => {} : onWave} />{window.bottom > 0 ? <View style={{ height: window.bottom }} /> : null}</View>;
  return <View style={[styles.codeRow, { width, position: "relative" }]}>
    {side === "before" ? <>{code}{gutter}</> : <>{gutter}{code}</>}
    {visibleRows.filter((row) => row.kind === "wave").map((row) => {
      if (row.kind !== "wave") return null;
      const bounds = waveBounds[row.index]?.[side];
      return bounds ? <View key={row.key} style={{ position: "absolute", top: bounds.top, left: 0, zIndex: 1 }}><Wave width={width} side={side} onPress={onExpandWave ? () => onExpandWave(row.index) : undefined} /></View> : null;
    })}
  </View>;
}

type ConnectorSegment =
  | { key: string; kind: "change"; color: string; before: Bounds; after: Bounds }
  | { key: string; kind: "wave"; color: string; before: Bounds; after: Bounds };

/** Both renderers consume these same viewport-relative endpoints. */
function connectorSegments(rows: PaneRow[], bounds: ChangeBounds, waveBounds: WaveBounds, offsets: { before: number; after: number }, height: number): ConnectorSegment[] {
  return rows.flatMap((row) => {
    if (row.kind !== "change" && row.kind !== "wave") return [];
    const pair = (row.kind === "change" ? bounds : waveBounds)[row.index];
    if (!pair?.before || !pair.after) return [];
    const before = { top: pair.before.top - offsets.before, bottom: pair.before.bottom - offsets.before };
    const after = { top: pair.after.top - offsets.after, bottom: pair.after.bottom - offsets.after };
    if (before.bottom < 0 || before.top > height || after.bottom < 0 || after.top > height) return [];
    return [{ key: row.key, kind: row.kind, color: row.kind === "wave" ? WAVE_COLOR : changeColors[row.tone], before, after }];
  });
}

export function Connector({ rows, bounds, waveBounds, offsets, height }: { rows: PaneRow[]; bounds: ChangeBounds; waveBounds: WaveBounds; offsets: { before: number; after: number }; height: number }) {
  return <View style={[styles.connector, { height }]}>
    {connectorSegments(rows, bounds, waveBounds, offsets, height).flatMap(({ key, kind, color, before, after }) => {
      if (kind === "change") {
        const topMin = Math.min(before.top, after.top);
        const topMax = Math.max(before.top, after.top);
        const bottomMin = Math.min(before.bottom, after.bottom);
        const bottomMax = Math.max(before.bottom, after.bottom);
        if (topMax <= bottomMin) return [
          topMax > topMin ? <Image key={`${key}-top`} source={{ uri: before.top < after.top ? topRising : topFalling }} resizeMode="stretch" style={{ position: "absolute", top: topMin, width: CONNECTOR_WIDTH, height: topMax - topMin, tintColor: color }} /> : null,
          bottomMin > topMax ? <View key={`${key}-middle`} style={{ position: "absolute", top: topMax, width: CONNECTOR_WIDTH, height: bottomMin - topMax, backgroundColor: color }} /> : null,
          bottomMax > bottomMin ? <Image key={`${key}-bottom`} source={{ uri: before.bottom < after.bottom ? bottomRising : bottomFalling }} resizeMode="stretch" style={{ position: "absolute", top: bottomMin, width: CONNECTOR_WIDTH, height: bottomMax - bottomMin, tintColor: color }} /> : null,
        ];
      }
      // Very short change blocks may have no full-width middle section.
      const stripWidth = 0.25;
      return Array.from({ length: CONNECTOR_WIDTH / stripWidth }, (_, index) => {
        const x = index * stripWidth;
        const ratio = (x + stripWidth / 2) / CONNECTOR_WIDTH;
        const top = before.top + (after.top - before.top) * ratio + (kind === "wave" ? WAVE_HEIGHT / 2 : 0);
        const bottom = kind === "wave" ? top + 1 : before.bottom + (after.bottom - before.bottom) * ratio;
        return <View key={`${key}-${index}`} style={{ position: "absolute", left: x, top, width: stripWidth, height: Math.max(1, bottom - top), backgroundColor: color }} />;
      });
    })}
    <View style={styles.connectorLine} />
  </View>;
}

export function connectorSvg(rows: PaneRow[], bounds: ChangeBounds, waveBounds: WaveBounds, offsets: { before: number; after: number }, height: number): string {
  const shapes: string[] = [];
  for (const segment of connectorSegments(rows, bounds, waveBounds, offsets, height)) {
    const { before, after, color } = segment;
    if (segment.kind === "change") {
      shapes.push(`<path d="M0 ${before.top} L${CONNECTOR_WIDTH} ${after.top} L${CONNECTOR_WIDTH} ${after.bottom} L0 ${before.bottom} Z" fill="${color}"/>`);
    } else {
      shapes.push(`<path d="M0 ${before.top + WAVE_HEIGHT / 2} L${CONNECTOR_WIDTH} ${after.top + WAVE_HEIGHT / 2}" fill="none" stroke="${color}" stroke-width="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CONNECTOR_WIDTH}" height="${height}" viewBox="0 0 ${CONNECTOR_WIDTH} ${height}">${shapes.join("")}</svg>`;
}


const styles = StyleSheet.create({
  lineNumberGutter: { width: LINE_NUMBER_WIDTH, backgroundColor: "#fff" },
  gutterLine: { height: 22, width: LINE_NUMBER_WIDTH },
  wave: { height: WAVE_HEIGHT, overflow: "hidden", justifyContent: "center", backgroundColor: "#fff", cursor: "pointer" },
  emptyChange: { height: 1 },
  connector: { width: CONNECTOR_WIDTH, overflow: "hidden", backgroundColor: "#fff", position: "relative" },
  connectorLine: { position: "absolute", top: 0, bottom: 0, left: CONNECTOR_WIDTH / 2, width: 1, backgroundColor: "rgba(71,85,105,0.18)" },
  codeRow: { flexDirection: "row", alignItems: "stretch" },
  cell: { flexDirection: "row", minHeight: 22 },
  contextCell: { backgroundColor: "#fff" },
  beforeLineNumber: { width: 38, paddingRight: 7, paddingTop: 3, color: "#94a3b8", textAlign: "right", fontFamily: "monospace", fontSize: 10 },
  afterLineNumber: { width: 38, paddingLeft: 7, paddingTop: 3, color: "#94a3b8", textAlign: "left", fontFamily: "monospace", fontSize: 10 },
  codeText: { minWidth: 0, paddingHorizontal: 9, paddingVertical: 3, color: "#263445", fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
  beforeCode: { textAlign: "left" },
  afterCode: { textAlign: "left" },
});
