import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { bindContextMenuTrigger, bindMenuKeyboard } from "../web";
import { menuPosition, type MenuPoint } from "./context-menu-model";

export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect(): void | Promise<void>;
} | { id: string; separator: true };

type Props = {
  children: ReactNode;
  items: readonly ContextMenuItem[];
  theme: PluginHostProps["theme"];
  label: string;
  compact?: boolean;
  showMore?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** FileActionsContextMenuContent uses 220; callers may widen long labels. */
  width?: number;
  onError?(error: unknown): void;
};

/** UI only: callers own target selection, mutations, confirmation and cache refresh. */
export function ContextMenu({ children, items, theme, label, compact = false, showMore = compact, disabled = false, style, width = 220, onError }: Props) {
  const trigger = useRef<View>(null);
  const [point, setPoint] = useState<MenuPoint | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [size, setSize] = useState({ width, height: 0 });
  const viewport = useWindowDimensions();
  const toast = useToast();
  const colors = theme.colors;
  const state = useRef({ disabled, pending, items });
  state.current = { disabled, pending, items };
  const close = useCallback(() => { setPoint(null); setHoveredId(null); setFocusedId(null); }, []);
  const open = useCallback((position: MenuPoint) => {
    if (!state.current.disabled && !state.current.pending && state.current.items.some((item) => !("separator" in item))) setPoint(position);
  }, []);
  useEffect(() => bindContextMenuTrigger(trigger.current, open), [open]);
  useEffect(close, [viewport.width, viewport.height, disabled, close]);
  const cleanupKeyboard = useRef<() => void>(() => {});
  const menuRef = useCallback((node: View | null) => {
    cleanupKeyboard.current();
    cleanupKeyboard.current = bindMenuKeyboard(node, close);
  }, [close]);
  useEffect(() => () => cleanupKeyboard.current(), []);
  const openAtTrigger = () => trigger.current?.measureInWindow((x, y, _width, height) => open({ x, y: y + height }));
  const select = async (item: Extract<ContextMenuItem, { label: string }>) => {
    if (item.disabled || state.current.pending) return;
    state.current.pending = true;
    setPending(true);
    close();
    try { await item.onSelect(); }
    catch (error) { if (onError) onError(error); else toast.error(error instanceof Error ? error.message : String(error)); }
    finally { state.current.pending = false; setPending(false); }
  };
  const position = point ? menuPosition(point, viewport, size) : { left: 8, top: 8 };
  const nativeSheet = compact || Platform.OS !== "web";
  return <View ref={trigger} style={style}>
    <Pressable onLongPress={Platform.OS === "web" ? undefined : openAtTrigger} accessible={false} style={styles.trigger}>
      {children}
      {showMore ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}更多操作`} accessibilityState={{ expanded: Boolean(point), disabled: disabled || pending }} disabled={disabled || pending} onPress={openAtTrigger} style={styles.more}><Icon name="Ellipsis" size={16} color={colors.foregroundMuted} /></Pressable> : null}
    </Pressable>
    <Modal visible={Boolean(point)} transparent animationType="none" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭操作菜单" onPress={close} style={StyleSheet.absoluteFill} />
        <View ref={menuRef} accessibilityRole="menu" accessibilityLabel={`${label}操作菜单`} onLayout={(event) => setSize(event.nativeEvent.layout)} style={[styles.menu, { backgroundColor: colors.surface1, borderColor: colors.border, maxHeight: Math.max(44, viewport.height - 16), width: Math.min(width, viewport.width - 16) }, nativeSheet ? { left: 8, right: 8, bottom: 8, width: undefined } : position]}>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {items.map((item) => "separator" in item ? <View key={item.id} style={[styles.separator, { backgroundColor: colors.border }]} /> : <Pressable key={item.id} accessibilityRole="menuitem" accessibilityLabel={item.label} accessibilityState={{ disabled: item.disabled }} disabled={item.disabled} onPress={() => void select(item)} onFocus={() => setFocusedId(item.id)} onBlur={() => setFocusedId(null)} onHoverIn={() => setHoveredId(item.id)} onHoverOut={() => setHoveredId(null)} style={({ pressed }) => [styles.item, { minHeight: nativeSheet ? 40 : 28, opacity: item.disabled ? 0.5 : 1, backgroundColor: !item.disabled && (hoveredId === item.id || focusedId === item.id || pressed) ? colors.surface2 : "transparent" }]}>
              <View style={styles.iconSpace}>{item.icon ? <Icon name={item.icon} size={14} color={item.destructive ? colors.statusDanger : colors.foregroundMuted} /> : null}</View>
              <Text style={[styles.itemLabel, { color: item.destructive ? colors.statusDanger : colors.foreground }]}>{item.label}</Text>
              {item.shortcut ? <Text style={[styles.shortcut, { color: colors.foregroundMuted }]}>{item.shortcut}</Text> : null}
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center" },
  more: { minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1 },
  menu: { position: "absolute", borderWidth: 1, borderRadius: 8, paddingVertical: 4, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 16, elevation: 4 },
  separator: { height: 1, marginVertical: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "transparent", marginHorizontal: 4, borderRadius: 6 },
  iconSpace: { width: 16, alignItems: "center", justifyContent: "center" },
  itemLabel: { flexShrink: 1, minWidth: 0, fontSize: 14, lineHeight: 18, fontWeight: "400" },
  shortcut: { fontSize: 12, marginLeft: "auto" },
});
