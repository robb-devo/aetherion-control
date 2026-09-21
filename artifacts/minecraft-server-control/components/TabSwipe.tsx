import { usePathname, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const TAB_ORDER = ['/', '/servers', '/console', '/tools'] as const;
const WIDTH = Dimensions.get('window').width;
const BG = '#08070D';
const LILAC = '#1A0B2E';

function normalizePath(path: string) {
  if (!path || path === '/index') return '/';
  const cleaned = path.replace(/\/$/, '') || '/';
  if (cleaned.endsWith('/index')) return '/';
  return cleaned;
}

export function TabSwipe({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const translateX = useSharedValue(0);
  const progress = useSharedValue(0);

  const finishNavigate = useCallback(
    (direction: -1 | 1) => {
      const current = normalizePath(pathname);
      const index = TAB_ORDER.findIndex((route) => route === current);
      const next = index >= 0 ? TAB_ORDER[index + direction] : undefined;
      if (!next) {
        translateX.value = withSpring(0, { damping: 22, stiffness: 240 });
        progress.value = withTiming(0, { duration: 160 });
        return;
      }
      router.replace(next as never);
      translateX.value = direction > 0 ? WIDTH * 0.12 : -WIDTH * 0.12;
      progress.value = 0.55;
      translateX.value = withSpring(0, { damping: 24, stiffness: 240, mass: 0.75 });
      progress.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
    },
    [pathname, progress, router, translateX],
  );

  const gesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-24, 24])
    .onUpdate((event) => {
      'worklet';
      const damped = event.translationX * 0.88;
      translateX.value = damped;
      progress.value = Math.min(1, Math.abs(damped) / (WIDTH * 0.55));
    })
    .onEnd((event) => {
      'worklet';
      const shouldGo = Math.abs(event.translationX) > WIDTH * 0.2 || Math.abs(event.velocityX) > 720;
      if (!shouldGo) {
        translateX.value = withSpring(0, { damping: 22, stiffness: 240 });
        progress.value = withTiming(0, { duration: 160 });
        return;
      }
      const direction: -1 | 1 = event.translationX < 0 ? 1 : -1;
      translateX.value = withTiming(direction > 0 ? -WIDTH : WIDTH, { duration: 210, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(finishNavigate)(direction);
      });
      progress.value = withTiming(1, { duration: 180 });
    });

  const panelStyle = useAnimatedStyle(() => ({
    flex: 1,
    backgroundColor: BG,
    transform: [{ translateX: translateX.value }],
  }));

  const veilStyle = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: interpolateColor(progress.value, [0, 1], [BG, LILAC]),
    opacity: progress.value * 0.92,
  }));

  return (
    <View style={[styles.root, { backgroundColor: LILAC }]}>
      <Animated.View pointerEvents="none" style={veilStyle} />
      <GestureDetector gesture={gesture}>
        <Animated.View style={panelStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
});
