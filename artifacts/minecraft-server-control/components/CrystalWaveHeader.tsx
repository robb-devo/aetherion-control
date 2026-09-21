import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const VIEW_H = 220;

type WavePalette = { bg0: string; bg1: string; waveA: string; waveB: string; waveC: string; kicker: string };

type Variant = 'home' | 'server';

type Props = {
  name: string;
  subtitle?: string;
  kicker?: string;
  variant?: Variant;
  /** Stable key for per-server wave tint (name or id). */
  toneKey?: string;
  onEditName?: () => void;
  onBack?: () => void;
  trailing?: React.ReactNode;
};

const HOME_PALETTE: WavePalette = {
  bg0: '#1A0B2E',
  bg1: '#3B1D6E',
  waveA: '#B07CFF',
  waveB: '#E8D4FF',
  waveC: '#FF8AD8',
  kicker: '#D7B8FF',
};

const SERVER_TONES: Record<string, WavePalette> = {
  proxy: {
    bg0: '#071820',
    bg1: '#0E4A5C',
    waveA: '#5EEAD4',
    waveB: '#A5F3FC',
    waveC: '#67E8F9',
    kicker: '#99F6E4',
  },
  hub: {
    bg0: '#1A0B2E',
    bg1: '#4C1D95',
    waveA: '#C084FC',
    waveB: '#E9D5FF',
    waveC: '#F0ABFC',
    kicker: '#E9D5FF',
  },
  'mmo-r': {
    bg0: '#2A0A1F',
    bg1: '#9D174D',
    waveA: '#FB7185',
    waveB: '#FECDD3',
    waveC: '#F472B6',
    kicker: '#FECDD3',
  },
  'mmo-d': {
    bg0: '#0B122E',
    bg1: '#1D4ED8',
    waveA: '#60A5FA',
    waveB: '#BFDBFE',
    waveC: '#818CF8',
    kicker: '#BFDBFE',
  },
  'mmo-c': {
    bg0: '#05201A',
    bg1: '#0F766E',
    waveA: '#2DD4BF',
    waveB: '#99F6E4',
    waveC: '#34D399',
    kicker: '#99F6E4',
  },
  sandbox: {
    bg0: '#1C1408',
    bg1: '#B45309',
    waveA: '#FBBF24',
    waveB: '#FDE68A',
    waveC: '#F59E0B',
    kicker: '#FDE68A',
  },
};

const FALLBACK_SERVER: WavePalette[] = [
  SERVER_TONES.hub!,
  SERVER_TONES.proxy!,
  SERVER_TONES['mmo-r']!,
  SERVER_TONES['mmo-d']!,
  SERVER_TONES['mmo-c']!,
  SERVER_TONES.sandbox!,
];

function hashTone(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function resolveServerTone(toneKey?: string): WavePalette {
  const key = (toneKey ?? '').trim().toLowerCase();
  if (!key) return SERVER_TONES.hub!;
  if (/proxy|velocity|edge/i.test(key)) return SERVER_TONES.proxy!;
  if (/hub/i.test(key)) return SERVER_TONES.hub!;
  if (/mmo[-_]?r\b|realm/i.test(key)) return SERVER_TONES['mmo-r']!;
  if (/mmo[-_]?d\b|dungeon/i.test(key)) return SERVER_TONES['mmo-d']!;
  if (/mmo[-_]?c\b|city|creative/i.test(key)) return SERVER_TONES['mmo-c']!;
  if (/sandbox|test|dev/i.test(key)) return SERVER_TONES.sandbox!;
  return FALLBACK_SERVER[hashTone(key) % FALLBACK_SERVER.length]!;
}

function wavePath(phase: number, amp: number, y: number) {
  'worklet';
  const w = 420;
  const steps = 10;
  let d = `M 0 ${y}`;
  for (let i = 0; i <= steps; i += 1) {
    const x = (i / steps) * w;
    const yy = y + Math.sin((i / steps) * Math.PI * 2 + phase) * amp;
    d += ` L ${x} ${yy}`;
  }
  d += ` L ${w} ${VIEW_H} L 0 ${VIEW_H} Z`;
  return d;
}

export function CrystalWaveHeader({
  name,
  subtitle,
  kicker = 'AETHERION',
  variant = 'home',
  toneKey,
  onEditName,
  onBack,
  trailing,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const phase = useSharedValue(0);
  const palette = variant === 'home' ? HOME_PALETTE : resolveServerTone(toneKey ?? name);
  const gid = `wave-${variant}-${((toneKey ?? name) || 'home').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'x'}`;

  useEffect(() => {
    phase.value = withRepeat(withTiming(Math.PI * 2, { duration: 10000, easing: Easing.linear }), -1, false);
  }, [phase]);

  const backProps = useAnimatedProps(() => ({ d: wavePath(phase.value, 12, 96) }));
  const midProps = useAnimatedProps(() => ({ d: wavePath(phase.value + 1.15, 16, 114) }));
  const frontProps = useAnimatedProps(() => ({ d: wavePath(phase.value + 2.3, 10, 132) }));

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'A';

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + (onBack ? 6 : 10) }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 420 ${VIEW_H}`} preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id={`${gid}Bg`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.bg0} stopOpacity="1" />
            <Stop offset="0.55" stopColor={palette.bg1} stopOpacity="1" />
            <Stop offset="0.82" stopColor="#140A22" stopOpacity="0.85" />
            <Stop offset="1" stopColor="#08070D" stopOpacity="0" />
          </SvgGradient>
          <SvgGradient id={`${gid}A`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.waveA} stopOpacity="0.38" />
            <Stop offset="1" stopColor={palette.waveA} stopOpacity="0" />
          </SvgGradient>
          <SvgGradient id={`${gid}B`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.waveB} stopOpacity="0.3" />
            <Stop offset="1" stopColor={palette.waveB} stopOpacity="0" />
          </SvgGradient>
          <SvgGradient id={`${gid}C`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.waveC} stopOpacity="0.22" />
            <Stop offset="1" stopColor={palette.waveC} stopOpacity="0" />
          </SvgGradient>
        </Defs>
        <Path d={`M0 0 H420 V${VIEW_H} H0 Z`} fill={`url(#${gid}Bg)`} />
        <AnimatedPath animatedProps={backProps} fill={`url(#${gid}A)`} />
        <AnimatedPath animatedProps={midProps} fill={`url(#${gid}B)`} />
        <AnimatedPath animatedProps={frontProps} fill={`url(#${gid}C)`} />
      </Svg>

      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
          <Feather name="chevron-left" size={22} color="#F8F4FF" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      ) : null}

      <View style={[styles.row, onBack && { paddingTop: 8 }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.kicker, { color: palette.kicker }]}>{kicker}</Text>
          {subtitle ? <Text style={styles.welcome}>{subtitle}</Text> : variant === 'home' ? <Text style={styles.welcome}>Welcome</Text> : null}
          <Pressable onPress={onEditName} hitSlop={8} disabled={!onEditName}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
          </Pressable>
        </View>
        {trailing ?? (
          onEditName ? (
            <Pressable
              onPress={onEditName}
              style={[styles.avatar, { borderColor: 'rgba(232,212,255,0.35)', backgroundColor: 'rgba(176,124,255,0.22)' }]}
            >
              <Text style={[styles.avatarText, { color: colors.accentForeground }]}>{initials}</Text>
            </Pressable>
          ) : null
        )}
      </View>

      <LinearGradient
        colors={[
          'rgba(8,7,13,0)',
          'rgba(8,7,13,0.15)',
          'rgba(8,7,13,0.45)',
          'rgba(8,7,13,0.78)',
          colors.background,
        ]}
        locations={[0, 0.25, 0.5, 0.75, 1]}
        style={styles.fade}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: -20,
    marginBottom: 0,
    minHeight: 196,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    zIndex: 2,
    gap: 2,
  },
  backText: {
    color: '#F8F4FF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingBottom: 52,
    minHeight: 132,
    zIndex: 1,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 88,
  },
  kicker: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 2.2,
    marginBottom: 6,
  },
  welcome: {
    color: 'rgba(245,247,250,0.78)',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  name: {
    color: '#F8F4FF',
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    letterSpacing: -0.9,
    marginTop: 2,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 0.4 },
});
