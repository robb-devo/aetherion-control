import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetCraftyServerLogsQueryKey, useGetCraftyServerLogs } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useServerControl } from '@/context/ServerContext';
import { Chip, SectionTitle, uiStyles } from '@/components/ControlUI';

export default function ConsoleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { runCommand, servers, isLoading, error, consoleTargetId, setConsoleTargetId } = useServerControl();
  const target = servers.find((server) => server.id === consoleTargetId) ?? servers[0];
  const params = useLocalSearchParams<{ prefill?: string }>();
  const [focused, setFocused] = useState(false);
  const [command, setCommand] = useState('');
  const [delivery, setDelivery] = useState<string | null>(null);
  const logScroll = useRef<ScrollView>(null);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    if (typeof params.prefill === 'string' && params.prefill) setCommand(params.prefill);
  }, [params.prefill]);
  const logs = useGetCraftyServerLogs(target?.id ?? '', {
    query: {
      queryKey: getGetCraftyServerLogsQueryKey(target?.id ?? ''),
      enabled: focused && Boolean(target?.id),
      refetchInterval: focused ? 5000 : false,
    },
  });
  const logLines = logs.data?.lines.slice(-80) ?? [];
  const send = () => {
    const pending = command;
    setDelivery(null);
    void runCommand(pending).then((accepted) => {
      if (!accepted) return;
      setCommand('');
      setDelivery(`Crafty accepted "${pending.trim()}". It shows up here when Crafty returns it in the log.`);
      void logs.refetch();
      setTimeout(() => void logs.refetch(), 1500);
    });
  };

  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[uiStyles.scroll, { paddingTop: insets.top + 16 }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.kicker, { color: colors.primary }]}>LIVE TOOLS</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Console</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {error
                ? 'Crafty unavailable'
                : target
                  ? `${target.name} · ${target.status}`
                  : isLoading
                    ? 'Connecting…'
                    : 'No server available'}
            </Text>
          </View>
          <View style={[styles.connected, { backgroundColor: colors.accent }]}>
            <View
              style={[
                styles.connectedDot,
                { backgroundColor: target?.status === 'online' ? colors.success : colors.warning },
              ]}
            />
            <Text style={[styles.connectedText, { color: colors.accentForeground }]}>
              {target?.status === 'online' ? 'LIVE' : 'IDLE'}
            </Text>
          </View>
        </View>

        <View style={styles.chips}>
          {servers.map((server) => (
            <Chip
              key={server.id}
              label={server.name}
              active={server.id === target?.id}
              onPress={() => setConsoleTargetId(server.id)}
            />
          ))}
        </View>

        <View style={[styles.consoleCard, { backgroundColor: '#0E1318', borderColor: colors.border }]}>
          <View style={styles.consoleTop}>
            <View style={styles.windowDots}>
              <View style={[styles.windowDot, { backgroundColor: colors.destructive }]} />
              <View style={[styles.windowDot, { backgroundColor: colors.warning }]} />
              <View style={[styles.windowDot, { backgroundColor: colors.success }]} />
            </View>
            <Text style={styles.consoleTitle}>{target ? `${target.name}.stdin` : 'console'}</Text>
            <Feather name="maximize-2" size={14} color="#6E7C8B" />
          </View>
          <View style={styles.logArea}>
            {!logs.isFetched && !logs.isError ? <Text style={styles.logText}>Loading logs from Crafty…</Text> : null}
            {logs.isError ? <Text style={[styles.logText, { color: '#FF6B6B' }]}>{logs.error instanceof Error ? logs.error.message : 'Crafty did not return logs.'}</Text> : null}
            {logs.isFetched && !logs.isError && logLines.length === 0 ? <Text style={styles.logText}>Crafty returned no log lines for this server.</Text> : null}
            <ScrollView ref={logScroll} nestedScrollEnabled style={styles.logScroll} onContentSizeChange={() => logScroll.current?.scrollToEnd({ animated: false })}>
              {logLines.map((line, index) => (
                <Text key={`${index}-${line}`} selectable style={styles.logText}>{line}</Text>
              ))}
            </ScrollView>
          </View>
          {delivery ? <Text style={styles.delivery}>{delivery}</Text> : null}
          <View style={styles.commandRow}>
            <Text style={styles.prompt}>›</Text>
            <TextInput
              value={command}
              onChangeText={setCommand}
              onSubmitEditing={send}
              editable={Boolean(target)}
              placeholder={target ? `Command → ${target.name}` : 'No Crafty server available'}
              placeholderTextColor="#687687"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
            />
            <Pressable
              disabled={!target}
              onPress={send}
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: colors.primary, opacity: target ? 1 : 0.35 },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Feather name="arrow-up" size={16} color={colors.primaryForeground} />
            </Pressable>
          </View>
        </View>

        <SectionTitle title="Command shortcuts" eyebrow="FREQUENTLY USED" />
        <View style={styles.chips}>
          {['list', 'save-all', 'tps', 'say Maintenance in 10m'].map((item) => (
            <Chip key={item} label={item} onPress={() => setCommand(item)} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 5 },
  connected: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  connectedDot: { width: 6, height: 6, borderRadius: 3 },
  connectedText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  consoleCard: { borderRadius: 20, borderWidth: 1, overflow: 'hidden', marginTop: 8 },
  consoleTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#26313B',
  },
  windowDots: { flexDirection: 'row', gap: 5 },
  windowDot: { width: 7, height: 7, borderRadius: 4 },
  consoleTitle: { flex: 1, color: '#8795A5', fontFamily: 'Inter_500Medium', fontSize: 11 },
  logArea: { paddingHorizontal: 14, paddingTop: 14, minHeight: 260 },
  logScroll: { maxHeight: 280 },
  logText: { color: '#C7D0DA', fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginBottom: 8 },
  delivery: { color: '#8FF0D6', fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, paddingHorizontal: 14, paddingBottom: 10 },
  commandRow: {
    borderTopWidth: 1,
    borderTopColor: '#26313B',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  prompt: { color: '#B7F34A', fontFamily: 'Inter_700Bold', fontSize: 20 },
  input: { flex: 1, color: '#F5F7FA', fontFamily: 'Inter_400Regular', fontSize: 12, minHeight: 34 },
  sendButton: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
});
