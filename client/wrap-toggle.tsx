import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";

export function WrapToggleButton({ active, onToggle, tooltipPlacement = "above" }: { active: boolean; onToggle(): void; tooltipPlacement?: "above" | "below" }) {
  const [hovered, setHovered] = useState(false);
  return <View style={styles.container}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="折行显示"
      aria-pressed={active}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onToggle}
      style={[styles.button, active && styles.active, hovered && styles.hover]}
    ><Icon name="WrapText" size={13} color="#64748b" /></Pressable>
    {hovered ? <View pointerEvents="none" style={[styles.tooltip, tooltipPlacement === "above" ? styles.above : styles.below]}><Text style={styles.tooltipText}>折行显示</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { position: "relative", zIndex: 2 },
  button: { width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  active: { backgroundColor: "#cbcbcd" },
  hover: { backgroundColor: "#e5e7eb" },
  tooltip: { position: "absolute", right: 0, width: 72, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 5, backgroundColor: "#1e293b", zIndex: 4 },
  above: { bottom: 24 },
  below: { top: 24 },
  tooltipText: { color: "#fff", fontSize: 11, textAlign: "center" },
});
