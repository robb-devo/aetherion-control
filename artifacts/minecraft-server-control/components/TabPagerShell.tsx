import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import HomeTab from '@/components/tabs/HomeTab';
import ServersTab from '@/components/tabs/ServersTab';
import ConsoleTab from '@/components/tabs/ConsoleTab';
import ToolsTab from '@/components/tabs/ToolsTab';

const WIDTH = Dimensions.get('window').width;
const ROUTES = ['/', '/servers', '/console', '/tools'] as const;
const LABELS = ['Home', 'Servers', 'Console', 'Tools'] as const;
const ICONS = ['home', 'server', 'terminal', 'tool'] as const;

function routeIndex(path: string) {
  const cleaned = !path || path === '/index' ? '/' : path.replace(/\/$/, '') || '/';
  const idx = ROUTES.findIndex((route) => route === cleaned);
  return idx >= 0 ? idx : 0;
}

/**
 * Side-by-side pager: adjacent tabs stay mounted so swiping reveals the real
 * next screen (not a solid lilac veil). Four screens is light enough.
 */
export function TabPagerShell() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const indexRef = useRef(routeIndex(pathname));
  const index = useSharedValue(routeIndex(pathname));
  const drag = useSharedValue(0);

  useEffect(() => {
    const next = routeIndex(pathname);
    indexRef.current = next;
    index.value = next;
    drag.value = withTiming(0, { duration: 0 });
  }, [drag, index, pathname]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(ROUTES.length - 1, next));
      indexRef.current = clamped;
      index.value = clamped;
      drag.value = 0;
      const route = ROUTES[clamped];
      if (route) router.replace(route as never);
    },
    [drag, index, router],
  );

  const settle = useCallback(
    (direction: -1 | 1 | 0) => {
      const current = indexRef.current;
      if (direction === 0) {
        drag.value = withSpring(0, { damping: 28, stiffness: 160, mass: 0.9 });
        return;
      }
      const next = current + direction;
      if (next < 0 || next >= ROUTES.length) {
        drag.value = withSpring(0, { damping: 28, stiffness: 160, mass: 0.9 });
        return;
      }
      drag.value = withTiming(-direction * WIDTH, { duration: 340, easing: Easing.bezier(0.22, 1, 0.36, 1) }, (finished) => {
        if (finished) runOnJS(goTo)(next);
      });
    },
    [drag, goTo],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 14])
        .failOffsetY([-32, 32])
        .onUpdate((event) => {
          'worklet';
          const atStart = index.value <= 0 && event.translationX > 0;
          const atEnd = index.value >= ROUTES.length - 1 && event.translationX < 0;
          const resistance = atStart || atEnd ? 0.28 : 1;
          drag.value = event.translationX * resistance;
        })
        .onEnd((event) => {
          'worklet';
          const shouldGo = Math.abs(event.translationX) > WIDTH * 0.16 || Math.abs(event.velocityX) > 520;
          if (!shouldGo) {
            runOnJS(settle)(0);
            return;
          }
          runOnJS(settle)(event.translationX < 0 ? 1 : -1);
        }),
    [drag, index, settle],
  );

  const rowStyle = useAnimatedStyle(() => ({
    flexDirection: 'row' as const,
    width: WIDTH * ROUTES.length,
    flex: 1,
    transform: [{ translateX: -index.value * WIDTH + drag.value }],
  }));

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={rowStyle}>
          <View style={styles.page}>
            <HomeTab />
          </View>
          <View style={styles.page}>
            <ServersTab />
          </View>
          <View style={styles.page}>
            <ConsoleTab />
          </View>
          <View style={styles.page}>
            <ToolsTab />
          </View>
        </Animated.View>
      </GestureDetector>

      <View
        style={[
          styles.tabBar,
          {
            paddingBottom: Math.max(insets.bottom, 10),
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        {LABELS.map((label, i) => {
          const active = routeIndex(pathname) === i;
          return (
            <Pressable key={label} onPress={() => goTo(i)} style={styles.tabItem} hitSlop={6}>
              <Feather name={ICONS[i]} size={22} color={active ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.tabLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  page: { width: WIDTH, flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3, minHeight: 48, justifyContent: 'center' },
  tabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
});
