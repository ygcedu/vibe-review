import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";

import { animateSessionStatusRing } from "../web";

// Match Paseo status-ring geometry: 6px dot, 1.5px gap/stroke, 1px halo.
export function SessionRunningIndicator({ backdrop, color }: { backdrop: string; color: string }) {
  const rotator = useRef<View>(null);
  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === "web") return animateSessionStatusRing(rotator.current);
    const animation = Animated.loop(Animated.timing(phase, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => { animation.stop(); };
  }, [phase]);
  return <View accessibilityRole="progressbar" accessibilityLabel="Agent running" style={[styles.frame, { backgroundColor: backdrop }]}>
    <View style={[styles.circle, styles.track, { borderColor: color }]} />
    {Platform.OS === "web" ? <View ref={rotator} style={styles.rotator}><View style={[styles.circle, styles.arc, { borderTopColor: color }]} /></View> : <Animated.View style={[styles.rotator, { transform: [{ rotate: phase.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }]}><View style={[styles.circle, styles.arc, { borderTopColor: color }]} /></Animated.View>}
    <View style={[styles.dot, { backgroundColor: color }]} />
  </View>;
}
const styles = StyleSheet.create({
  frame: { position: "absolute", right: -5, bottom: -5, width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  circle: { position: "absolute", width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  rotator: { position: "absolute", width: 12, height: 12 },
  track: { opacity: 0.3 },
  arc: { borderColor: "transparent", opacity: 0.9 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
