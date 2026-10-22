import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { bindToolbarTooltip } from "../web";
import { Icon } from "@getpaseo/plugin/client/react-native";

type Props = {
  label: string;
  size?: number;
  icon: string;
  disabled?: boolean;
  onPress(): void;
  theme: PluginHostProps["theme"];
  boundary?: { width: number };
};

export function ToolbarButton({ label, icon, disabled = false, onPress, theme, boundary, size = 32 }: Props) {
  const anchor = useRef<View>(null);
  const [anchorLayout, setAnchorLayout] = useState({ x: 0, width: 32 });
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const hide = useCallback(() => { clear(); setVisible(false); }, [clear]);
  const show = useCallback(() => { clear(); timer.current = setTimeout(() => { timer.current = null; setVisible(true); }, 350); }, [clear]);
  useEffect(() => bindToolbarTooltip(anchor.current, show, hide), [show, hide]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const colors = theme.colors;
  const tooltipWidth = boundary?.width ? Math.min(116, Math.max(0, boundary.width - 8)) : 116;
  const centeredLeft = (anchorLayout.width - tooltipWidth) / 2;
  const tooltipLeft = boundary?.width
    ? Math.max(4 - anchorLayout.x, Math.min(centeredLeft, boundary.width - anchorLayout.x - tooltipWidth - 4))
    : centeredLeft;
  return <View ref={anchor} onLayout={(event) => { const { x, width } = event.nativeEvent.layout; setAnchorLayout({ x, width }); }} style={[styles.anchor, visible && styles.raised]}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onHoverIn={show} onHoverOut={hide} onFocus={show} onBlur={hide} onPress={onPress} style={({ pressed }) => [styles.button, { width: size, height: size, opacity: disabled ? 0.35 : 1, backgroundColor: pressed ? colors.surface2 : "transparent" }]}>
      <Icon name={icon} size={18} color={colors.foregroundMuted} />
    </Pressable>
    {visible ? <View pointerEvents="none" role="tooltip" style={[styles.tooltip, { backgroundColor: colors.foreground, left: tooltipLeft, width: tooltipWidth }]}><Text style={[styles.text, { color: colors.surface0 }]}>{label}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  anchor: { position: "relative" },
  raised: { zIndex: 1 },
  button: { width: 32, height: 32, justifyContent: "center", alignItems: "center", borderRadius: 4 },
  tooltip: { position: "absolute", bottom: 30, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 5, elevation: 6 },
  text: { fontSize: 12, lineHeight: 16, textAlign: "center" },
});
