import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type PointerEvent as RNPointerEvent, type ViewStyle } from "react-native";
import type { DiffCell, DiffFile } from "./diff";
import { buildPaneRows, buildSplitDiffRows, expandCollapsedRows, gapKey } from "./diff";
import { highlightSplitRows } from "./syntax";
import { changedSpansByCell } from "./intraline";
import { buildVerticalTrack, positionForOffset, positionsAt } from "./vertical-sync";
import { CODE_PADDING, CONNECTOR_WIDTH, LINE_NUMBER_WIDTH, Connector, NoWrapPane, WrapPane, connectorSvg, fixedNoWrapBounds, fixedNoWrapHeight, type ChangeBounds, type RecordChange, type WaveBounds } from "./split-diff-render";

const DIVIDER_WIDTH = 14;
const MAX_VIEWPORT_HEIGHT = 520;
const VERTICAL_SCROLLBAR_STYLE_ID = "vibe-review-vertical-scrollbars";

function installVerticalScrollbarStyle() {
  const doc = (globalThis as typeof globalThis & { document?: Document }).document;
  if (!doc) return;
  const style = doc.getElementById(VERTICAL_SCROLLBAR_STYLE_ID) ?? doc.createElement("style");
  style.id = VERTICAL_SCROLLBAR_STYLE_ID;
  style.textContent = `
#vibe-review-before-vertical, #vibe-review-after-vertical {
  scrollbar-width: none;
}
#vibe-review-before-vertical::-webkit-scrollbar,
#vibe-review-after-vertical::-webkit-scrollbar {
  display: none;
}
`;
  if (!style.isConnected) doc.head.append(style);
}

function clampRatio(ratio: number, width: number): number {
  const minRatio = Math.min(0.35, 160 / Math.max(width, 1));
  return Math.max(minRatio, Math.min(1 - minRatio, ratio));
}

function measuredBounds(fallback: ChangeBounds, measured: ChangeBounds): ChangeBounds {
  const result: ChangeBounds = { ...fallback };
  for (const [key, pair] of Object.entries(measured)) {
    if (pair.before && pair.after) result[Number(key)] = pair;
  }
  return result;
}

/** Two aligned panes modeled after an IDE side-by-side diff. */
export function SplitDiff({ file, wrapLines, collapseUnchanged = true, syncScrolling = true, loadFullFile, maxHeight = MAX_VIEWPORT_HEIGHT }: { file: DiffFile; wrapLines: boolean; collapseUnchanged?: boolean; syncScrolling?: boolean; loadFullFile?: () => Promise<DiffFile | null>; maxHeight?: number }) {
  const [fullFile, setFullFile] = useState<DiffFile | null>(null);
  const [openedGaps, setOpenedGaps] = useState<Set<string>>(new Set());
  useEffect(() => { setFullFile(null); setOpenedGaps(new Set()); }, [file.lines]);
  useEffect(() => { if (collapseUnchanged) setOpenedGaps(new Set()); }, [collapseUnchanged]);
  const requestFullFile = async () => {
    if (fullFile) return fullFile;
    try {
      const loaded = await loadFullFile?.() ?? null;
      if (loaded) setFullFile(loaded);
      return loaded;
    } catch { return null; }
  };
  useEffect(() => { if (!collapseUnchanged && !fullFile) void requestFullFile(); }, [collapseUnchanged, fullFile, file.lines]);
  const rows = useMemo(() => {
    const base = buildSplitDiffRows(file.lines);
    if (!fullFile) return base;
    const full = buildSplitDiffRows(fullFile.lines);
    return collapseUnchanged ? expandCollapsedRows(base, full, openedGaps) : full;
  }, [file.lines, fullFile?.lines, collapseUnchanged, openedGaps]);
  const expandWave = (index: number) => {
    const row = rows[index];
    if (!row) return;
    const key = gapKey(row);
    void requestFullFile().then((loaded) => { if (loaded) setOpenedGaps((current) => new Set(current).add(key)); });
  };
  const changedSpans = useMemo(() => changedSpansByCell(rows), [rows]);
  const beforeRows = useMemo(() => buildPaneRows(rows, "before"), [rows]);
  const afterRows = useMemo(() => buildPaneRows(rows, "after"), [rows]);
  const noWrapBounds = useMemo(() => fixedNoWrapBounds(beforeRows, afterRows), [beforeRows, afterRows]);
  const [tokens, setTokens] = useState<Awaited<ReturnType<typeof highlightSplitRows>>>(new Map());
  useEffect(() => {
    let active = true;
    setTokens(new Map());
    void highlightSplitRows(rows, file.path).then((result) => {
      if (active) setTokens(result);
    });
    return () => { active = false; };
  }, [rows, file.path]);
  const [changeBounds, setChangeBounds] = useState<ChangeBounds>({});
  const [waveBounds, setWaveBounds] = useState<WaveBounds>({});
  const displayChangeBounds = wrapLines ? changeBounds : noWrapBounds.changes;
  const displayWaveBounds = wrapLines ? waveBounds : noWrapBounds.waves;
  const nativeChangeBounds = wrapLines ? changeBounds : measuredBounds(noWrapBounds.changes, changeBounds);
  const nativeWaveBounds = wrapLines ? waveBounds : measuredBounds(noWrapBounds.waves, waveBounds);
  const [paneHeights, setPaneHeights] = useState({ before: 0, after: 0 });
  const [verticalOffsets, setVerticalOffsets] = useState({ before: 0, after: 0 });
  const [hoveredScrollbar, setHoveredScrollbar] = useState<"before" | "after" | null>(null);
  const scrollbarDrag = useRef<{ side: "before" | "after"; startY: number; startOffset: number } | null>(null);
  const [hoveredHorizontal, setHoveredHorizontal] = useState<"before" | "after" | null>(null);
  const horizontalDrag = useRef<{ side: "before" | "after"; startX: number; startOffset: number } | null>(null);
  const [horizontalOffsets, setHorizontalOffsets] = useState({ before: 0, after: 0 });
  const [scrollbarsVisible, setScrollbarsVisible] = useState(false);
  const scrollbarHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showScrollbars = () => {
    if (Platform.OS !== "web") return;
    setScrollbarsVisible(true);
    if (scrollbarHideTimer.current) clearTimeout(scrollbarHideTimer.current);
    scrollbarHideTimer.current = setTimeout(() => {
      if (scrollbarDrag.current || horizontalDrag.current) showScrollbars();
      else setScrollbarsVisible(false);
    }, 1400);
  };
  useEffect(() => () => {
    if (scrollbarHideTimer.current) clearTimeout(scrollbarHideTimer.current);
  }, []);
  const viewportNode = useRef<View>(null);
  const connectorDrawing = useRef<View>(null);
  const beforeVertical = useRef<ScrollView>(null);
  const afterVertical = useRef<ScrollView>(null);
  const measuredLayoutKey = useRef(`${file.path}\0${wrapLines}`);
  const requestedVertical = useRef({ before: 0, after: 0 });
  const virtualPosition = useRef(0);
  const viewportHeight = Math.min(maxHeight, Math.max(32, paneHeights.before, paneHeights.after));
  const nativeContentHeight = Math.max(fixedNoWrapHeight(beforeRows), fixedNoWrapHeight(afterRows), paneHeights.before, paneHeights.after);
  const nativeViewportHeight = Math.min(maxHeight, Math.max(32, nativeContentHeight));
  const [nativeScrollPosition, setNativeScrollPosition] = useState(0);
  const scrollHeights = Platform.OS === "web" ? paneHeights : {
    before: paneHeights.before || fixedNoWrapHeight(beforeRows),
    after: paneHeights.after || fixedNoWrapHeight(afterRows),
  };
  useEffect(() => {
    if (Platform.OS === "web") installVerticalScrollbarStyle();
  }, []);
  const verticalTrack = useMemo(() => {
    const points = [{ before: 0, after: 0 }];
    for (const row of beforeRows) {
      if (row.kind !== "change" && row.kind !== "wave") continue;
      const pair = row.kind === "change" ? displayChangeBounds[row.index] : displayWaveBounds[row.index];
      if (!pair?.before || !pair.after) continue;
      points.push({ before: pair.before.top, after: pair.after.top });
      points.push({ before: pair.before.bottom, after: pair.after.bottom });
    }
    points.push({ before: scrollHeights.before, after: scrollHeights.after });
    return buildVerticalTrack(points);
  }, [beforeRows, displayChangeBounds, displayWaveBounds, scrollHeights.before, scrollHeights.after]);
  const nativeVirtualHeight = Math.max(nativeViewportHeight, verticalTrack.at(-1)?.virtualEnd ?? 0, nativeContentHeight);
  const drawConnector = (offsets: { before: number; after: number }) => {
    if (Platform.OS !== "web") return;
    const drawing = connectorDrawing.current as unknown as HTMLElement | null;
    if (drawing) drawing.innerHTML = connectorSvg(beforeRows, displayChangeBounds, displayWaveBounds, offsets, viewportHeight);
  };
  useLayoutEffect(() => {
    drawConnector(requestedVertical.current);
  }, [beforeRows, displayChangeBounds, displayWaveBounds, viewportHeight]);
  const applyVerticalPosition = (position: number) => {
    showScrollbars();
    const visibleHeight = Platform.OS === "web" ? viewportHeight : nativeViewportHeight;
    const end = verticalTrack[verticalTrack.length - 1]?.virtualEnd ?? 0;
    const next = Math.max(0, Math.min(Math.max(0, end - visibleHeight), position));
    virtualPosition.current = next;
    const mapped = positionsAt(verticalTrack, next);
    const offsets = {
      before: Math.min(Math.max(0, scrollHeights.before - visibleHeight), mapped.before),
      after: Math.min(Math.max(0, scrollHeights.after - visibleHeight), mapped.after),
    };
    requestedVertical.current = offsets;
    if (Platform.OS === "web") {
      beforeVertical.current?.scrollTo({ y: offsets.before, animated: false });
      afterVertical.current?.scrollTo({ y: offsets.after, animated: false });
      drawConnector(offsets);
    } else setNativeScrollPosition(next);
    setVerticalOffsets((current) => Math.abs(current.before - offsets.before) < 0.5 && Math.abs(current.after - offsets.after) < 0.5 ? current : offsets);
  };
  const applySideVerticalOffset = (side: "before" | "after", offset: number) => {
    const next = Math.max(0, Math.min(Math.max(0, paneHeights[side] - viewportHeight), offset));
    requestedVertical.current = { ...requestedVertical.current, [side]: next };
    (side === "before" ? beforeVertical : afterVertical).current?.scrollTo({ y: next, animated: false });
    setVerticalOffsets({ ...requestedVertical.current });
    drawConnector(requestedVertical.current);
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
      if (!syncScrolling || event.ctrlKey || event.shiftKey || !Number.isFinite(event.deltaY) || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !verticalTrack.length) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewportHeight : 1;
      applyVerticalPosition(virtualPosition.current + event.deltaY * unit);
    };
    const onNativeScroll = (side: "before" | "after", element: HTMLElement) => {
      const y = element.scrollTop;
      if (Math.abs(requestedVertical.current[side] - y) < 1) return;
      if (!syncScrolling) {
        requestedVertical.current = { ...requestedVertical.current, [side]: y };
        setVerticalOffsets({ ...requestedVertical.current });
        drawConnector(requestedVertical.current);
        return;
      }
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
  }, [verticalTrack, viewportHeight, paneHeights, beforeRows, displayChangeBounds, displayWaveBounds, syncScrolling]);
  useLayoutEffect(() => {
    const nextKey = `${file.path}\0${wrapLines}`;
    if (measuredLayoutKey.current === nextKey) return;
    measuredLayoutKey.current = nextKey;
    setChangeBounds({});
    setWaveBounds({});
    setPaneHeights({ before: 0, after: 0 });
    setVerticalOffsets({ before: 0, after: 0 });
    requestedVertical.current = { before: 0, after: 0 };
    virtualPosition.current = 0;
    setNativeScrollPosition(0);
    horizontalPositions.current = { before: 0, after: 0 };
    setHorizontalOffsets({ before: 0, after: 0 });
  }, [file.path, wrapLines]);
  const onPaneHeight = (side: "before" | "after", height: number) => setPaneHeights((current) => current[side] === height ? current : { ...current, [side]: height });
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
  const applyHorizontalScroll = (side: "before" | "after", requestedX: number) => {
    showScrollbars();
    const targetSide = side === "before" ? "after" : "before";
    const previousX = horizontalPositions.current[side];
    const sourceMax = side === "before" ? beforeMaxScroll : afterMaxScroll;
    const sourceX = Math.max(0, Math.min(sourceMax, requestedX));
    horizontalPositions.current[side] = sourceX;
    if (Math.abs(sourceX - previousX) < 0.01) return;
    (side === "before" ? beforeScroll : afterScroll).current?.scrollTo({ x: sourceX, animated: false });
    (side === "before" ? beforeFooter : afterFooter).current?.scrollTo({ x: sourceX, animated: false });
    if (!syncScrolling) { setHorizontalOffsets({ ...horizontalPositions.current }); return; }
    // Keep the same physical scroll offset on both sides. A shorter side stops
    // at its own end while the longer side can continue and return independently.
    const targetMax = side === "before" ? afterMaxScroll : beforeMaxScroll;
    const targetX = Math.max(0, Math.min(targetMax, sourceX));
    if (Math.abs(horizontalPositions.current[targetSide] - targetX) < 0.01) {
      setHorizontalOffsets((current) => Math.abs(current[side] - sourceX) < 0.5 ? current : { ...current, [side]: sourceX });
      return;
    }
    horizontalPositions.current[targetSide] = targetX;
    (side === "before" ? afterScroll : beforeScroll).current?.scrollTo({ x: targetX, animated: false });
    (side === "before" ? afterFooter : beforeFooter).current?.scrollTo({ x: targetX, animated: false });
    setHorizontalOffsets({ before: horizontalPositions.current.before, after: horizontalPositions.current.after });
  };
  const syncScroll = (side: "before" | "after", event: NativeSyntheticEvent<NativeScrollEvent>) => applyHorizontalScroll(side, event.nativeEvent.contentOffset.x);
  const renderPane = (side: "before" | "after", paneWidth: number) => {
    const paneRows = side === "before" ? beforeRows : afterRows;
    if (wrapLines) return <WrapPane rows={paneRows} side={side} width={paneWidth} tokens={tokens} changedSpans={changedSpans} onChange={onChange} onWave={onWave} onExpandWave={loadFullFile ? expandWave : undefined} />;
    return <NoWrapPane rows={paneRows} side={side} width={paneWidth} contentWidth={Math.max(paneWidth - LINE_NUMBER_WIDTH, minCodeWidths[side])} tokens={tokens} changedSpans={changedSpans} scrollRef={side === "before" ? beforeScroll : afterScroll} onScroll={(event) => syncScroll(side, event)} onChange={onChange} onWave={onWave} onExpandWave={loadFullFile ? expandWave : undefined} waveBounds={displayWaveBounds} visibleOffset={verticalOffsets[side]} viewportHeight={viewportHeight} />;
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
  const verticalScrollbar = (side: "before" | "after", left: number) => {
    const maxOffset = Math.max(0, paneHeights[side] - viewportHeight);
    if (Platform.OS !== "web" || maxOffset <= 0) return null;
    const thumbHeight = Math.max(28, viewportHeight * viewportHeight / paneHeights[side]);
    const thumbTravel = viewportHeight - thumbHeight;
    const top = verticalOffsets[side] / maxOffset * thumbTravel;
    const onPointerDown = (event: RNPointerEvent) => {
      event.preventDefault();
      (event.currentTarget as unknown as HTMLElement).setPointerCapture(event.nativeEvent.pointerId);
      const trackTop = (event.currentTarget as unknown as HTMLElement).getBoundingClientRect().top;
      const clickedThumb = event.target !== event.currentTarget;
      const offset = clickedThumb ? verticalOffsets[side] : Math.max(0, Math.min(maxOffset, (event.nativeEvent.clientY - trackTop - thumbHeight / 2) / thumbTravel * maxOffset));
      scrollbarDrag.current = { side, startY: event.nativeEvent.clientY, startOffset: offset };
      if (syncScrolling) applyVerticalPosition(positionForOffset(verticalTrack, side, offset));
      else applySideVerticalOffset(side, offset);
    };
    const onPointerMove = (event: RNPointerEvent) => {
      const drag = scrollbarDrag.current;
      if (!drag || drag.side !== side) return;
      const offset = Math.max(0, Math.min(maxOffset, drag.startOffset + (event.nativeEvent.clientY - drag.startY) / thumbTravel * maxOffset));
      if (syncScrolling) applyVerticalPosition(positionForOffset(verticalTrack, side, offset));
      else applySideVerticalOffset(side, offset);
    };
    return <View key={`${side}-scrollbar`} pointerEvents={scrollbarsVisible ? "auto" : "none"} style={[styles.scrollbarTrack, { left, height: viewportHeight, opacity: scrollbarsVisible ? 1 : 0 }, { transition: "opacity 400ms ease-out" } as ViewStyle]} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { scrollbarDrag.current = null; }} onPointerCancel={() => { scrollbarDrag.current = null; }}>
      <View style={[styles.scrollbarThumb, side === "before" ? { left: 2 } : { right: 2 }, { top, height: thumbHeight, backgroundColor: hoveredScrollbar === side ? "rgba(100,116,139,0.65)" : "rgba(100,116,139,0.42)" }]} onPointerEnter={() => setHoveredScrollbar(side)} onPointerLeave={() => setHoveredScrollbar((current) => current === side ? null : current)} />
    </View>;
  };
  const horizontalScrollbar = (side: "before" | "after", trackWidth: number) => {
    const maxOffset = side === "before" ? beforeMaxScroll : afterMaxScroll;
    if (Platform.OS !== "web" || maxOffset <= 0) return null;
    const contentWidth = trackWidth + maxOffset;
    const thumbWidth = Math.max(28, trackWidth * trackWidth / contentWidth);
    const thumbTravel = trackWidth - thumbWidth;
    const left = horizontalOffsets[side] / maxOffset * thumbTravel;
    const onPointerDown = (event: RNPointerEvent) => {
      event.preventDefault();
      const track = event.currentTarget as unknown as HTMLElement;
      track.setPointerCapture(event.nativeEvent.pointerId);
      const clickedThumb = event.target !== event.currentTarget;
      const offset = clickedThumb ? horizontalOffsets[side] : Math.max(0, Math.min(maxOffset, (event.nativeEvent.clientX - track.getBoundingClientRect().left - thumbWidth / 2) / thumbTravel * maxOffset));
      horizontalDrag.current = { side, startX: event.nativeEvent.clientX, startOffset: offset };
      applyHorizontalScroll(side, offset);
    };
    const onPointerMove = (event: RNPointerEvent) => {
      const drag = horizontalDrag.current;
      if (!drag || drag.side !== side) return;
      const offset = Math.max(0, Math.min(maxOffset, drag.startOffset + (event.nativeEvent.clientX - drag.startX) / thumbTravel * maxOffset));
      applyHorizontalScroll(side, offset);
    };
    return <View pointerEvents={scrollbarsVisible ? "auto" : "none"} style={[styles.horizontalTrack, { width: trackWidth, opacity: scrollbarsVisible ? 1 : 0 }, { transition: "opacity 400ms ease-out" } as ViewStyle]} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { horizontalDrag.current = null; }} onPointerCancel={() => { horizontalDrag.current = null; }}>
      <View style={[styles.horizontalThumb, { left, width: thumbWidth, backgroundColor: hoveredHorizontal === side ? "rgba(100,116,139,0.65)" : "rgba(100,116,139,0.42)" }]} onPointerEnter={() => setHoveredHorizontal(side)} onPointerLeave={() => setHoveredHorizontal((current) => current === side ? null : current)} />
    </View>;
  };

  return (
    <View
      ref={viewportNode}
      style={styles.viewport}
      onPointerMove={showScrollbars}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        widthRef.current = nextWidth;
        setWidth(nextWidth);
      }}
    >
      {width > 0 ? <>
        {Platform.OS === "web" ? <View style={[styles.codeRow, { width, height: viewportHeight }]}>
          <ScrollView key={`before-${wrapLines}`} nativeID="vibe-review-before-vertical" ref={beforeVertical} style={[styles.verticalScroll, styles.leftVerticalScroll, { width: leftWidth, height: viewportHeight }]} nestedScrollEnabled showsVerticalScrollIndicator={false} scrollEventThrottle={16} onContentSizeChange={(_width, height) => onPaneHeight("before", height)}>
            <View style={[{ width: leftWidth }, Platform.OS === "web" && styles.leftVerticalContent]}>
              {renderPane("before", leftWidth)}
            </View>
          </ScrollView>
          <View style={[styles.connector, { height: viewportHeight }]}><View style={styles.connectorLine} /><View ref={connectorDrawing} style={styles.connectorDrawing} /></View>
          <ScrollView key={`after-${wrapLines}`} nativeID="vibe-review-after-vertical" ref={afterVertical} style={[styles.verticalScroll, { width: rightWidth, height: viewportHeight }]} nestedScrollEnabled showsVerticalScrollIndicator={false} scrollEventThrottle={16} onContentSizeChange={(_width, height) => onPaneHeight("after", height)}>
            {renderPane("after", rightWidth)}
          </ScrollView>
        </View> : <ScrollView key={`native-${wrapLines}`} style={{ width, height: nativeViewportHeight, backgroundColor: "#fff" }} nestedScrollEnabled showsVerticalScrollIndicator scrollEventThrottle={16} onScroll={(event) => applyVerticalPosition(event.nativeEvent.contentOffset.y)}>
          <View style={[styles.codeRow, { width, height: nativeVirtualHeight, alignItems: "flex-start" }]}>
            <View style={{ width: leftWidth, transform: [{ translateY: nativeScrollPosition - verticalOffsets.before }] }} onLayout={(event) => onPaneHeight("before", event.nativeEvent.layout.height)}>
              {renderPane("before", leftWidth)}
            </View>
            <View style={{ transform: [{ translateY: nativeScrollPosition }] }}>
              <Connector rows={beforeRows} bounds={nativeChangeBounds} waveBounds={nativeWaveBounds} offsets={verticalOffsets} height={nativeContentHeight} />
            </View>
            <View style={{ width: rightWidth, transform: [{ translateY: nativeScrollPosition - verticalOffsets.after }] }} onLayout={(event) => onPaneHeight("after", event.nativeEvent.layout.height)}>
              {renderPane("after", rightWidth)}
            </View>
          </View>
        </ScrollView>}
        {verticalScrollbar("before", 0)}
        {verticalScrollbar("after", width - 8)}
        {!wrapLines ? (
        <View pointerEvents="box-none" style={[styles.codeRow, { position: "absolute", top: (Platform.OS === "web" ? viewportHeight : nativeViewportHeight) - 18, left: 0, zIndex: 3, width, height: 18 }]}>
          <View pointerEvents={Platform.OS === "web" ? "box-none" : "auto"} style={{ width: leftWidth - LINE_NUMBER_WIDTH }}>
            {Platform.OS === "web" ? horizontalScrollbar("before", leftWidth - LINE_NUMBER_WIDTH) : <ScrollView horizontal bounces={false} overScrollMode="never" ref={beforeFooter} onScroll={(event) => syncScroll("before", event)} scrollEventThrottle={16} style={styles.footerScroll}><View style={{ width: Math.max(leftWidth - LINE_NUMBER_WIDTH, minCodeWidths.before), height: 1 }} /></ScrollView>}
          </View>
          <View pointerEvents="none" style={{ width: LINE_NUMBER_WIDTH + CONNECTOR_WIDTH }} />
          <View pointerEvents="none" style={{ width: LINE_NUMBER_WIDTH }} />
          <View pointerEvents={Platform.OS === "web" ? "box-none" : "auto"} style={{ width: rightWidth - LINE_NUMBER_WIDTH }}>
            {Platform.OS === "web" ? horizontalScrollbar("after", rightWidth - LINE_NUMBER_WIDTH) : <ScrollView horizontal bounces={false} overScrollMode="never" ref={afterFooter} onScroll={(event) => syncScroll("after", event)} scrollEventThrottle={16} style={styles.footerScroll}><View style={{ width: Math.max(rightWidth - LINE_NUMBER_WIDTH, minCodeWidths.after), height: 1 }} /></ScrollView>}
          </View>
        </View>
        ) : null}
        <View {...webPointerHandlers} accessibilityRole="adjustable" accessibilityLabel="调整左右对照宽度" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }} style={[styles.divider, { left: leftWidth + CONNECTOR_WIDTH / 2 - DIVIDER_WIDTH / 2, height: Platform.OS === "web" ? viewportHeight : nativeViewportHeight }]}>
          <View style={styles.dividerLine} />
        </View>
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { position: "relative", minHeight: 32 },
  verticalScroll: { backgroundColor: "#fff" },
  scrollbarTrack: { position: "absolute", top: 0, width: 8, zIndex: 2 },
  scrollbarThumb: { position: "absolute", width: 6, borderRadius: 3, cursor: "pointer" },
  horizontalTrack: { height: 18, position: "relative" },
  horizontalThumb: { position: "absolute", bottom: 2, height: 6, borderRadius: 3, cursor: "pointer" },
  leftVerticalScroll: { direction: "rtl" },
  leftVerticalContent: { direction: "ltr" },
  footerScroll: { height: 18 },
  connector: { width: CONNECTOR_WIDTH, overflow: "hidden", backgroundColor: "#fff", position: "relative" },
  connectorDrawing: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" },
  connectorLine: { position: "absolute", top: 0, bottom: 0, left: CONNECTOR_WIDTH / 2, width: 1, backgroundColor: "rgba(71,85,105,0.18)" },
  codeRow: { flexDirection: "row", alignItems: "stretch" },
  divider: { position: "absolute", top: 0, bottom: 0, width: DIVIDER_WIDTH, alignItems: "center", justifyContent: "center", cursor: "col-resize" as ViewStyle["cursor"] },
  dividerLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(71,85,105,0.28)" },
});
