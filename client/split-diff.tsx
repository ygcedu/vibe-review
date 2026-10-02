import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type PointerEvent as RNPointerEvent, type ViewStyle } from "react-native";
import type { DiffCell, DiffFile } from "./diff";
import { buildPaneRows, buildSplitDiffRows } from "./diff";
import { highlightSplitRows } from "./syntax";
import { buildVerticalTrack, positionForOffset, positionsAt } from "./vertical-sync";
import { CODE_PADDING, CONNECTOR_WIDTH, LINE_NUMBER_WIDTH, Connector, NoWrapPane, WrapPane, connectorSvg, type ChangeBounds, type RecordChange, type WaveBounds } from "./split-diff-render";

const DIVIDER_WIDTH = 14;
const MAX_VIEWPORT_HEIGHT = 520;

function clampRatio(ratio: number, width: number): number {
  const minRatio = Math.min(0.35, 160 / Math.max(width, 1));
  return Math.max(minRatio, Math.min(1 - minRatio, ratio));
}

/** Two aligned panes modeled after an IDE side-by-side diff. */
export function SplitDiff({ file, wrapLines }: { file: DiffFile; wrapLines: boolean }) {
  const rows = useMemo(() => buildSplitDiffRows(file.lines), [file.lines]);
  const beforeRows = useMemo(() => buildPaneRows(rows, "before"), [rows]);
  const afterRows = useMemo(() => buildPaneRows(rows, "after"), [rows]);
  const tokens = useMemo(() => highlightSplitRows(rows, file.path), [rows, file.path]);
  const [changeBounds, setChangeBounds] = useState<ChangeBounds>({});
  const [waveBounds, setWaveBounds] = useState<WaveBounds>({});
  const [paneHeights, setPaneHeights] = useState({ before: 0, after: 0 });
  const [verticalOffsets, setVerticalOffsets] = useState({ before: 0, after: 0 });
  const viewportNode = useRef<View>(null);
  const connectorDrawing = useRef<View>(null);
  const beforeVertical = useRef<ScrollView>(null);
  const afterVertical = useRef<ScrollView>(null);
  const requestedVertical = useRef({ before: 0, after: 0 });
  const virtualPosition = useRef(0);
  const viewportHeight = Math.min(MAX_VIEWPORT_HEIGHT, Math.max(32, paneHeights.before, paneHeights.after));
  const verticalTrack = useMemo(() => {
    const points = [{ before: 0, after: 0 }];
    for (const row of beforeRows) {
      if (row.kind !== "change" && row.kind !== "wave") continue;
      const pair = row.kind === "change" ? changeBounds[row.index] : waveBounds[row.index];
      if (!pair?.before || !pair.after) continue;
      points.push({ before: pair.before.top, after: pair.after.top });
      points.push({ before: pair.before.bottom, after: pair.after.bottom });
    }
    points.push({ before: paneHeights.before, after: paneHeights.after });
    return buildVerticalTrack(points);
  }, [beforeRows, changeBounds, waveBounds, paneHeights]);
  const drawConnector = (offsets: { before: number; after: number }) => {
    if (Platform.OS !== "web") return;
    const drawing = connectorDrawing.current as unknown as HTMLElement | null;
    if (drawing) drawing.innerHTML = connectorSvg(beforeRows, changeBounds, waveBounds, offsets, viewportHeight);
  };
  useLayoutEffect(() => {
    drawConnector(requestedVertical.current);
  }, [beforeRows, changeBounds, waveBounds, viewportHeight]);
  const applyVerticalPosition = (position: number) => {
    const end = verticalTrack[verticalTrack.length - 1]?.virtualEnd ?? 0;
    const next = Math.max(0, Math.min(Math.max(0, end - viewportHeight), position));
    virtualPosition.current = next;
    const mapped = positionsAt(verticalTrack, next);
    const offsets = {
      before: Math.min(Math.max(0, paneHeights.before - viewportHeight), mapped.before),
      after: Math.min(Math.max(0, paneHeights.after - viewportHeight), mapped.after),
    };
    requestedVertical.current = offsets;
    beforeVertical.current?.scrollTo({ y: offsets.before, animated: false });
    afterVertical.current?.scrollTo({ y: offsets.after, animated: false });
    drawConnector(offsets);
    if (Platform.OS !== "web") setVerticalOffsets(offsets);
  };
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const viewport = viewportNode.current as unknown as HTMLElement | null;
    const before = viewport?.querySelector<HTMLElement>('#vibe-review-before-vertical');
    const after = viewport?.querySelector<HTMLElement>('#vibe-review-after-vertical');
    if (!viewport || !before || !after) return;
    // A non-passive capture listener blocks native asynchronous wheel scrolling.
    // The panes and connector can then move together before the next paint.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || !Number.isFinite(event.deltaY) || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !verticalTrack.length) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewportHeight : 1;
      applyVerticalPosition(virtualPosition.current + event.deltaY * unit);
    };
    const onNativeScroll = (side: "before" | "after", element: HTMLElement) => {
      const y = element.scrollTop;
      if (Math.abs(requestedVertical.current[side] - y) < 1) return;
      virtualPosition.current = positionForOffset(verticalTrack, side, y);
      applyVerticalPosition(virtualPosition.current);
    };
    const onBeforeScroll = () => onNativeScroll("before", before);
    const onAfterScroll = () => onNativeScroll("after", after);
    viewport.addEventListener("wheel", onWheel, { capture: true, passive: false });
    before.addEventListener("scroll", onBeforeScroll, { passive: true });
    after.addEventListener("scroll", onAfterScroll, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel, true);
      before.removeEventListener("scroll", onBeforeScroll);
      after.removeEventListener("scroll", onAfterScroll);
    };
  }, [verticalTrack, viewportHeight, paneHeights, beforeRows, changeBounds, waveBounds]);
  useEffect(() => {
    setChangeBounds({});
    setWaveBounds({});
    setPaneHeights({ before: 0, after: 0 });
    setVerticalOffsets({ before: 0, after: 0 });
    requestedVertical.current = { before: 0, after: 0 };
    virtualPosition.current = 0;
  }, [file.path, wrapLines]);
  const onPaneHeight = (side: "before" | "after", height: number) => setPaneHeights((current) => current[side] === height ? current : { ...current, [side]: height });
  const onVerticalScroll = (side: "before" | "after", event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    if (Math.abs(requestedVertical.current[side] - y) < 1) {
      if (Platform.OS !== "web") setVerticalOffsets((current) => Math.abs(current[side] - y) < 0.5 ? current : { ...current, [side]: y });
      return;
    }
    virtualPosition.current = positionForOffset(verticalTrack, side, y);
    applyVerticalPosition(virtualPosition.current);
  };
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
      ref={viewportNode}
      style={styles.viewport}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        widthRef.current = nextWidth;
        setWidth(nextWidth);
      }}
    >
      {width > 0 ? <>
        <View style={[styles.codeRow, { width, height: viewportHeight }]}>
          <ScrollView key={`before-${wrapLines}`} nativeID="vibe-review-before-vertical" ref={beforeVertical} style={[styles.verticalScroll, Platform.OS === "web" && styles.leftVerticalScroll, { width: leftWidth, height: viewportHeight }]} nestedScrollEnabled showsVerticalScrollIndicator scrollEventThrottle={16} onScroll={Platform.OS === "web" ? undefined : (event) => onVerticalScroll("before", event)} onContentSizeChange={(_width, height) => onPaneHeight("before", height)}>
            <View style={[{ width: leftWidth }, Platform.OS === "web" && styles.leftVerticalContent]}>
              {wrapLines ? <WrapPane rows={beforeRows} side="before" width={leftWidth} tokens={tokens} onChange={onChange} onWave={onWave} /> : <NoWrapPane rows={beforeRows} side="before" width={leftWidth} contentWidth={Math.max(leftWidth - LINE_NUMBER_WIDTH, minCodeWidths.before)} tokens={tokens} scrollRef={beforeScroll} onScroll={(event) => syncScroll("before", event)} onChange={onChange} onWave={onWave} waveBounds={waveBounds} />}
            </View>
          </ScrollView>
          {Platform.OS === "web" ? <View style={[styles.connector, { height: viewportHeight }]}><View style={styles.connectorLine} /><View ref={connectorDrawing} style={styles.connectorDrawing} /></View> : <Connector rows={beforeRows} bounds={changeBounds} offsets={verticalOffsets} height={viewportHeight} />}
          <ScrollView key={`after-${wrapLines}`} nativeID="vibe-review-after-vertical" ref={afterVertical} style={[styles.verticalScroll, { width: rightWidth, height: viewportHeight }]} nestedScrollEnabled showsVerticalScrollIndicator scrollEventThrottle={16} onScroll={Platform.OS === "web" ? undefined : (event) => onVerticalScroll("after", event)} onContentSizeChange={(_width, height) => onPaneHeight("after", height)}>
            {wrapLines ? <WrapPane rows={afterRows} side="after" width={rightWidth} tokens={tokens} onChange={onChange} onWave={onWave} /> : <NoWrapPane rows={afterRows} side="after" width={rightWidth} contentWidth={Math.max(rightWidth - LINE_NUMBER_WIDTH, minCodeWidths.after)} tokens={tokens} scrollRef={afterScroll} onScroll={(event) => syncScroll("after", event)} onChange={onChange} onWave={onWave} waveBounds={waveBounds} />}
          </ScrollView>
        </View>
        {!wrapLines ? (
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
        ) : null}
        <View {...webPointerHandlers} accessibilityRole="adjustable" accessibilityLabel="调整左右对照宽度" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }} style={[styles.divider, { left: leftWidth + CONNECTOR_WIDTH / 2 - DIVIDER_WIDTH / 2, height: viewportHeight }]}>
          <View style={styles.dividerLine} />
        </View>
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { position: "relative", minHeight: 32 },
  verticalScroll: { backgroundColor: "#fff" },
  leftVerticalScroll: { direction: "rtl" },
  leftVerticalContent: { direction: "ltr" },
  footerScroll: { height: 18, backgroundColor: "#f8fafc" },
  connector: { width: CONNECTOR_WIDTH, overflow: "hidden", backgroundColor: "#fff", position: "relative" },
  connectorDrawing: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" },
  connectorLine: { position: "absolute", top: 0, bottom: 0, left: CONNECTOR_WIDTH / 2, width: 1, backgroundColor: "rgba(71,85,105,0.18)" },
  codeRow: { flexDirection: "row", alignItems: "stretch" },
  divider: { position: "absolute", top: 0, bottom: 0, width: DIVIDER_WIDTH, alignItems: "center", justifyContent: "center", cursor: "col-resize" as ViewStyle["cursor"] },
  dividerLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(71,85,105,0.28)" },
});
