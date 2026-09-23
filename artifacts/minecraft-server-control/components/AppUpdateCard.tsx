import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MetricBar, PrimaryButton } from '@/components/ControlUI';
import { useAppUpdate } from '@/context/AppUpdate';
import { formatByteSize } from '@/lib/appUpdate';
import { useColors } from '@/hooks/useColors';

export function AppUpdateCard() {
  const colors = useColors();
  const update = useAppUpdate();
  const { phase, installed } = update;
  const release = phase.kind === 'checking' || phase.kind === 'failed' ? null : phase.decision.release;
  const notes = release?.notes ? release.notes.slice(0, 420) : '';

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.kicker, { color: colors.primary }]}>APP UPDATE</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Android install</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        This build is {installed}. Updates are sideloaded APKs from GitHub releases. Google Play in-app updates do not apply, because AETHERION is not installed from the Play Store.
      </Text>

      {phase.kind === 'checking' ? <Text style={[styles.body, { color: colors.foreground }]}>Checking GitHub releases…</Text> : null}
      {phase.kind === 'failed' ? <Text style={[styles.body, { color: colors.destructive }]}>{phase.message}</Text> : null}

      {release && phase.kind === 'ready' && phase.decision.kind === 'current' ? (
        <Text style={[styles.body, { color: colors.foreground }]}>This build matches the latest GitHub release ({release.version}).</Text>
      ) : null}
      {release && phase.kind === 'ready' && phase.decision.kind === 'ahead' ? (
        <Text style={[styles.body, { color: colors.foreground }]}>
          This build is newer than the latest GitHub release ({release.version}). No older APK will be downloaded.
        </Text>
      ) : null}
      {release && phase.kind === 'ready' && phase.decision.kind === 'unparsed' ? (
        <Text style={[styles.body, { color: colors.foreground }]}>
          GitHub published {release.version}, but this build's version could not be compared. Nothing will be installed automatically.
        </Text>
      ) : null}

      {release && (phase.kind === 'ready' && phase.decision.kind === 'update' || phase.kind === 'downloading' || phase.kind === 'downloaded' || phase.kind === 'handed-off' || phase.kind === 'install-failed') ? (
        <View style={styles.stack}>
          <Text style={[styles.release, { color: colors.foreground }]}>{release.name}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {formatByteSize(release.size)} APK. Android will ask you to confirm the install. That system screen is required for sideloaded updates, and this app cannot accept it for you.
          </Text>
          {notes ? <Text style={[styles.notes, { color: colors.mutedForeground }]}>{notes}</Text> : null}
          <View style={styles.steps}>
            <Step n="1" text="Download the APK. Progress follows the bytes received." />
            <Step n="2" text="Open Android's installer and review the prompt." />
            <Step n="3" text="If Android blocks unknown apps, allow installs for AETHERION, then open the installer again." />
            <Step n="4" text="The version here changes only after the app restarts on that build. Cancelling the prompt leaves this build installed." />
          </View>
        </View>
      ) : null}

      {phase.kind === 'downloading' ? (
        <View style={styles.stack}>
          <Text style={[styles.body, { color: colors.foreground }]}>
            {phase.total ? `Downloaded ${formatByteSize(phase.written)} of ${formatByteSize(phase.total)}` : `Downloaded ${formatByteSize(phase.written)}`}
          </Text>
          {phase.total ? <MetricBar value={Math.min(100, (phase.written / phase.total) * 100)} color={colors.primary} /> : null}
        </View>
      ) : null}

      {phase.kind === 'downloaded' ? (
        <Text style={[styles.body, { color: colors.foreground }]}>
          Downloaded {formatByteSize(phase.bytes)}, matching the GitHub asset. Continue when you are ready for Android's confirmation screen.
        </Text>
      ) : null}
      {phase.kind === 'handed-off' ? (
        <Text style={[styles.body, { color: colors.foreground }]}>
          Android closed the installer. This app cannot see whether you confirmed it. If you did, the version under this card changes after AETHERION restarts on the new build.
        </Text>
      ) : null}
      {phase.kind === 'install-failed' ? <Text style={[styles.body, { color: colors.destructive }]}>{phase.message}</Text> : null}

      <View style={styles.actions}>
        {phase.kind === 'failed' || phase.kind === 'handed-off' || (phase.kind === 'ready' && phase.decision.kind !== 'update') ? (
          <PrimaryButton icon="refresh-cw" label="Check again" onPress={() => void update.check()} />
        ) : null}
        {phase.kind === 'ready' && phase.decision.kind === 'update' ? (
          <PrimaryButton icon="download" label={Platform.OS === 'android' ? 'Download APK' : 'Open GitHub release'} onPress={() => void update.download()} />
        ) : null}
        {phase.kind === 'install-failed' && !phase.canInstall ? (
          <PrimaryButton icon="download" label="Download APK" onPress={() => void update.download()} />
        ) : null}
        {phase.kind === 'downloaded' || (phase.kind === 'install-failed' && phase.canInstall) ? (
          <PrimaryButton icon="download" label="Open system installer" onPress={() => void update.install()} />
        ) : null}
        {Platform.OS === 'android' && (phase.kind === 'downloaded' || phase.kind === 'install-failed' || phase.kind === 'handed-off') ? (
          <Pressable onPress={() => void update.openSettings()} style={({ pressed }) => [styles.secondary, { borderColor: colors.border }, pressed && { opacity: 0.75 }]}>
            <Feather name="settings" size={15} color={colors.foreground} />
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>Allow installs from this app</Text>
          </Pressable>
        ) : null}
        {release ? (
          <Pressable onPress={() => void update.openRelease()} hitSlop={8}>
            <Text style={[styles.link, { color: colors.primary }]}>Open the GitHub release</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  const colors = useColors();
  return (
    <View style={styles.step}>
      <Text style={[styles.stepNo, { color: colors.primary }]}>{n}</Text>
      <Text style={[styles.stepText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10, marginTop: 16, marginBottom: 8 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.4 },
  release: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  notes: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  stack: { gap: 8 },
  steps: { gap: 6 },
  step: { flexDirection: 'row', gap: 8 },
  stepNo: { fontFamily: 'Inter_700Bold', fontSize: 12, width: 14 },
  stepText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  actions: { gap: 8, marginTop: 2 },
  secondary: { minHeight: 44, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'center', paddingVertical: 4 },
});
