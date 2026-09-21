import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getCraftyServerLogs, sendCraftyServerCommand } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type Props = {
  visible: boolean;
  serverId: string;
  player: string | null;
  onClose: () => void;
};

function sanitizeName(name: string) {
  return name.replace(/[\[\]'"\\]/g, '').trim();
}

export function PlayerDevSheet({ visible, serverId, player, onClose }: Props) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [whisper, setWhisper] = useState('');
  const [inventoryDump, setInventoryDump] = useState<string | null>(null);
  const name = player ? sanitizeName(player) : '';

  const run = async (command: string, label: string) => {
    if (!name || !serverId) return;
    setBusy(true);
    setNotice(null);
    try {
      await sendCraftyServerCommand(serverId, { command });
      setNotice(`${label} · sent to Crafty`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Command failed');
    } finally {
      setBusy(false);
    }
  };

  const confirm = (title: string, body: string, command: string, label: string) => {
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Do it', style: 'destructive', onPress: () => void run(command, label) },
    ]);
  };

  const peekInventory = async () => {
    if (!name || !serverId) return;
    setBusy(true);
    setNotice(null);
    setInventoryDump(null);
    try {
      await sendCraftyServerCommand(serverId, { command: `data get entity ${name} Inventory` });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const logs = await getCraftyServerLogs(serverId);
      const hit =
        (logs.lines ?? [])
          .slice()
          .reverse()
          .find((line) => /Inventory/i.test(line) && new RegExp(name, 'i').test(line)) ??
        (logs.lines ?? []).slice(-6).join('\n');
      setInventoryDump(hit || 'No inventory line found in recent logs yet — try again or check Console.');
      setNotice('Inventory query · sent');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Inventory query failed');
    } finally {
      setBusy(false);
    }
  };

  if (!player) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            <View style={styles.handle} />
            <Text style={[styles.kicker, { color: colors.primary }]}>PLAYER DEV</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>{name}</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Commands go to Crafty stdin as plain console text. Inventory peek reads the reply from live logs.
            </Text>

            <Text style={[styles.section, { color: colors.mutedForeground }]}>MODERATION</Text>
            <View style={styles.grid}>
              <Action icon="log-out" label="Kick" color={colors.warning} onPress={() => confirm(`Kick ${name}?`, 'Disconnects the player.', `kick ${name}`, 'Kick')} />
              <Action icon="slash" label="Ban" color={colors.destructive} onPress={() => confirm(`Ban ${name}?`, 'Permanent ban until pardoned.', `ban ${name}`, 'Ban')} />
              <Action icon="clock" label="Timeout 1h" color={colors.warning} onPress={() => void run(`kick ${name} Timeout 1h - come back later`, 'Timeout kick')} />
              <Action icon="check-circle" label="Pardon" color={colors.success} onPress={() => void run(`pardon ${name}`, 'Pardon')} />
            </View>

            <Text style={[styles.section, { color: colors.mutedForeground }]}>LIVE</Text>
            <View style={styles.grid}>
              <Action icon="heart" label="Heal" color={colors.success} onPress={() => void run(`effect give ${name} minecraft:instant_health 1 10 true`, 'Heal')} />
              <Action icon="coffee" label="Feed" color={colors.info} onPress={() => void run(`effect give ${name} minecraft:saturation 1 10 true`, 'Feed')} />
              <Action icon="zap" label="Kill" color={colors.destructive} onPress={() => confirm(`Kill ${name}?`, 'Instantly kills the player.', `kill ${name}`, 'Kill')} />
              <Action icon="navigation" label="Spawn TP" color={colors.primary} onPress={() => void run(`tp ${name} 0 100 0`, 'TP spawn')} />
            </View>

            <Text style={[styles.section, { color: colors.mutedForeground }]}>MODE & DATA</Text>
            <View style={styles.grid}>
              <Action icon="box" label="Survival" color={colors.primary} onPress={() => void run(`gamemode survival ${name}`, 'Survival')} />
              <Action icon="edit-3" label="Creative" color={colors.info} onPress={() => void run(`gamemode creative ${name}`, 'Creative')} />
              <Action icon="trash" label="Clear inv" color={colors.destructive} onPress={() => confirm(`Clear ${name} inventory?`, 'Removes all items.', `clear ${name}`, 'Clear')} />
              <Action icon="package" label="View inv" color={colors.warning} onPress={() => void peekInventory()} />
            </View>

            {inventoryDump ? (
              <View style={[styles.dump, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.dumpTitle, { color: colors.foreground }]}>Inventory (from logs)</Text>
                <Text selectable style={[styles.dumpBody, { color: colors.mutedForeground }]}>
                  {inventoryDump}
                </Text>
              </View>
            ) : null}

            <Text style={[styles.section, { color: colors.mutedForeground }]}>MESSAGE</Text>
            <View style={styles.whisperRow}>
              <TextInput
                value={whisper}
                onChangeText={setWhisper}
                placeholder={`Whisper to ${name}`}
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              <Pressable
                disabled={!whisper.trim() || busy}
                onPress={() => {
                  void run(`tell ${name} ${whisper.trim()}`, 'Whisper');
                  setWhisper('');
                }}
                style={[styles.send, { backgroundColor: colors.primary, opacity: whisper.trim() ? 1 : 0.4 }]}
              >
                <Feather name="send" size={16} color={colors.primaryForeground} />
              </Pressable>
            </View>

            {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} /> : null}
            {notice ? <Text style={[styles.notice, { color: colors.success }]}>{notice}</Text> : null}

            <Pressable onPress={onClose} style={[styles.close, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.closeText, { color: colors.foreground }]}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Action({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { borderColor: colors.border, backgroundColor: colors.background },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Feather name={icon} size={16} color={color} />
      <Text style={[styles.actionLabel, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8,7,13,0.72)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 14,
  },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.6, marginTop: 4 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 8 },
  section: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4, marginTop: 14, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    width: '48%',
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  whisperRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  send: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  notice: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 10 },
  close: { marginTop: 16, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  dump: { marginTop: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  dumpTitle: { fontFamily: 'Inter_700Bold', fontSize: 12, marginBottom: 6 },
  dumpBody: { fontFamily: 'monospace', fontSize: 10, lineHeight: 14 },
});
