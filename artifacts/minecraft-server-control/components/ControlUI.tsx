import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeader}>
      <View>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      {action && onAction ? <Pressable onPress={onAction} hitSlop={10}><Text style={[styles.action, { color: colors.primary }]}>{action}</Text></Pressable> : null}
    </View>
  );
}

export function StatusDot({ status }: { status: string }) {
  const colors = useColors();
  const color = status === 'online' ? colors.success : status === 'degraded' ? colors.warning : status === 'restarting' ? colors.info : colors.destructive;
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

export function IconButton({ icon, onPress, variant = 'muted' }: { icon: keyof typeof Feather.glyphMap; onPress?: () => void; variant?: 'muted' | 'primary' }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.iconButton, { backgroundColor: variant === 'primary' ? colors.primary : colors.secondary }, pressed && styles.pressed]}>
      <Feather name={icon} size={18} color={variant === 'primary' ? colors.primaryForeground : colors.foreground} />
    </Pressable>
  );
}

export function MetricBar({ value, color }: { value: number; color?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
      <View style={[styles.barFill, { width: `${Math.min(value, 100)}%`, backgroundColor: color ?? colors.primary }]} />
    </View>
  );
}

export function Chip({ label, active = false, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, { backgroundColor: active ? colors.primary : colors.secondary, borderColor: active ? colors.primary : colors.border }, pressed && styles.pressed]}><Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{label}</Text></Pressable>;
}

export function PrimaryButton({ label, icon, onPress, disabled = false }: { label: string; icon?: keyof typeof Feather.glyphMap; onPress?: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: disabled ? 0.45 : 1 }, pressed && !disabled && styles.pressed]}>
      {icon ? <Feather name={icon} size={16} color={colors.primaryForeground} /> : null}
      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

export const uiStyles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 112 },
  card: { borderRadius: 22, borderWidth: 1, padding: 16 },
  mutedText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
});

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12, marginTop: 26 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6, marginBottom: 5 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.5 },
  action: { fontFamily: 'Inter_600SemiBold', fontSize: 13, paddingBottom: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  barTrack: { height: 6, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  chip: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1 },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 15, paddingHorizontal: 16 },
  primaryButtonText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
});
