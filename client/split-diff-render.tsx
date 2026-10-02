import { Platform, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle, type ViewStyle } from "react-native";
import type { RefObject } from "react";
import { lightHighlightColors, type HighlightToken } from "@getpaseo/highlight";
import type { DiffCell, PaneRow } from "./diff";

export const LINE_NUMBER_WIDTH = 38;
export const CODE_PADDING = 18;
export const CONNECTOR_WIDTH = 20;
const WAVE_HEIGHT = 12;
const WAVE_PERIOD = 16;
const WAVE_COLOR = "#cbd5e1";
const changeColors = { modify: "#dceaff", add: "#e3f5e9", remove: "#ffe7e7" } as const;

function CodeLine({ cell, side, tone, tokens, wrapLines, showLineNumber = true, visibleCodeWidth }: { cell: DiffCell; side: "before" | "after"; tone?: keyof typeof changeColors; tokens?: HighlightToken[]; wrapLines: boolean; showLineNumber?: boolean; visibleCodeWidth?: number }) {
  const code = tokens?.length ? tokens.map((token, index) => <Text key={index} style={{ fontFamily: "monospace", color: token.style ? lightHighlightColors[token.style] : undefined }}>{token.text.replace(/\t/g, "    ")}</Text>) : cell.text.replace(/\t/g, "    ");
  const wrapStyle = Platform.OS === "web" ? ({ whiteSpace: wrapLines ? "pre-wrap" : "pre", overflowWrap: wrapLines ? "anywhere" : "normal", fontFamily: "monospace" } as unknown as TextStyle) : undefined;
  return (
    <View style={[styles.cell, tone ? { backgroundColor: changeColors[tone] } : styles.contextCell, visibleCodeWidth !== undefined && { width: "100%" }]}>
      {side === "before" ? (
        <>
          <Text selectable style={[styles.codeText, styles.beforeCode, { flex: 1 }, wrapStyle]}>{code}</Text>
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

export type Bounds = { top: number; bottom: number };
export type ChangeBounds = Record<number, { before?: Bounds; after?: Bounds }>;
export type RecordChange = (side: "before" | "after", index: number, top: number, height: number) => void;
export type WaveBounds = Record<number, { before?: Bounds; after?: Bounds }>;

export function WrapPane({ rows, side, width, tokens, onChange, onWave }: { rows: PaneRow[]; side: "before" | "after"; width: number; tokens: Map<DiffCell, HighlightToken[]>; onChange: RecordChange; onWave: RecordChange }) {
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

export function NoWrapPane({ rows, side, width, contentWidth, tokens, scrollRef, onScroll, onChange, onWave, waveBounds }: { rows: PaneRow[]; side: "before" | "after"; width: number; contentWidth: number; tokens: Map<DiffCell, HighlightToken[]>; scrollRef: RefObject<ScrollView | null>; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void; onChange: RecordChange; onWave: RecordChange; waveBounds: WaveBounds }) {
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

export function Connector({ rows, bounds, offsets, height }: { rows: PaneRow[]; bounds: ChangeBounds; offsets: { before: number; after: number }; height: number }) {
  const shifted = (pair: { before?: Bounds; after?: Bounds }) => pair.before && pair.after ? {
    before: { top: pair.before.top - offsets.before, bottom: pair.before.bottom - offsets.before },
    after: { top: pair.after.top - offsets.after, bottom: pair.after.bottom - offsets.after },
  } : null;
  const visible = (bounds: Bounds) => bounds.bottom >= 0 && bounds.top <= height;
  return <View style={[styles.connector, { height }]}>
    {rows.filter((row) => row.kind === "change").map((row) => {
      if (row.kind !== "change") return null;
      const pair = shifted(bounds[row.index] ?? {});
      if (!pair || !visible(pair.before) || !visible(pair.after)) return null;
      const top = Math.min(pair.before.top, pair.after.top);
      const bottom = Math.max(pair.before.bottom, pair.after.bottom);
      return <View key={row.key} style={[styles.connectorChange, { top, height: Math.max(1, bottom - top), backgroundColor: changeColors[row.tone] }]} />;
    })}
    <View style={styles.connectorLine} />
  </View>;
}

export function connectorSvg(rows: PaneRow[], bounds: ChangeBounds, waveBounds: WaveBounds, offsets: { before: number; after: number }, height: number): string {
  const shapes: string[] = [];
  for (const row of rows) {
    if (row.kind !== "change" && row.kind !== "wave") continue;
    const pair = row.kind === "change" ? bounds[row.index] : waveBounds[row.index];
    if (!pair?.before || !pair.after) continue;
    const before = { top: pair.before.top - offsets.before, bottom: pair.before.bottom - offsets.before };
    const after = { top: pair.after.top - offsets.after, bottom: pair.after.bottom - offsets.after };
    if (before.bottom < 0 || before.top > height || after.bottom < 0 || after.top > height) continue;
    if (row.kind === "change") {
      shapes.push(`<path d="M0 ${before.top} L${CONNECTOR_WIDTH} ${after.top} L${CONNECTOR_WIDTH} ${after.bottom} L0 ${before.bottom} Z" fill="${changeColors[row.tone]}"/>`);
    } else {
      shapes.push(`<path d="M0 ${before.top + WAVE_HEIGHT / 2} L${CONNECTOR_WIDTH} ${after.top + WAVE_HEIGHT / 2}" fill="none" stroke="${WAVE_COLOR}" stroke-width="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CONNECTOR_WIDTH}" height="${height}" viewBox="0 0 ${CONNECTOR_WIDTH} ${height}">${shapes.join("")}</svg>`;
}


const styles = StyleSheet.create({
  lineNumberGutter: { width: LINE_NUMBER_WIDTH, backgroundColor: "#fff" },
  gutterLine: { height: 22, width: LINE_NUMBER_WIDTH },
  wave: { height: WAVE_HEIGHT, overflow: "hidden", justifyContent: "center", backgroundColor: "#fff" },
  waveText: { color: "#cbd5e1", fontSize: 13, lineHeight: WAVE_HEIGHT, letterSpacing: 1, marginTop: -2 },
  emptyChange: { height: 1 },
  connector: { width: CONNECTOR_WIDTH, overflow: "hidden", backgroundColor: "#fff", position: "relative" },
  connectorChange: { position: "absolute", left: 0, right: 0 },
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
