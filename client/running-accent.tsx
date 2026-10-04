import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

/** A quiet breathing accent that signals a verification is still running. */
export function RunningAccent({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.9, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.35, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View pointerEvents="none" style={[styles.accent, { backgroundColor: color, opacity }]} />;
}

const styles = StyleSheet.create({
  accent: { position: "absolute", left: 0, top: 12, bottom: 12, width: 3, borderRadius: 3 },
});
