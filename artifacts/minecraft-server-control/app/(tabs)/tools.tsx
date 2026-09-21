import { Feather } from '@expo/vector-icons';
import {
  ProvisioningInputRegion,
  ProvisioningInputServerType,
  ProvisioningInputSize,
  getGetProvisioningJobQueryKey,
  type ProvisioningChoice,
  type ProvisioningInput,
  type ProvisioningJob,
  useCreateProvisioningJob,
  useGetProvisioningJob,
  useGetProvisioningOptions,
} from '@workspace/api-client-react';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { PrimaryButton, SectionTitle, uiStyles } from '@/components/ControlUI';
import { useColors } from '@/hooks/useColors';

type Field = 'version' | 'serverType' | 'region' | 'size';

export default function ToolsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const optionsQuery = useGetProvisioningOptions();
  const createJob = useCreateProvisioningJob();
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.21.8');
  const [serverType, setServerType] = useState<ProvisioningInputServerType>(ProvisioningInputServerType.paper);
  const [region, setRegion] = useState<ProvisioningInputRegion>(ProvisioningInputRegion.nbg1);
  const [size, setSize] = useState<ProvisioningInputSize>(ProvisioningInputSize.cpx32);
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const jobQuery = useGetProvisioningJob(jobId, {
    query: {
      queryKey: getGetProvisioningJobQueryKey(jobId),
      enabled: Boolean(jobId),
      refetchInterval: (query) => {
        const job = query.state.data as ProvisioningJob | undefined;
        return job?.status === 'ready' || job?.status === 'failed' ? false : 2000;
      },
    },
  });
  const job = jobQuery.data;
  const options = optionsQuery.data;

  const submit = () => {
    setError(null);
    const cleanName = name.trim();
    if (!/^[a-zA-Z0-9-]{3,32}$/.test(cleanName)) {
      setError('Use 3–32 letters, numbers, or hyphens for the server name.');
      return;
    }
    const data: ProvisioningInput = { name: cleanName, version, serverType, region, size };
    createJob.mutate({ data }, {
      onSuccess: (created) => setJobId(created.id),
      onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Provisioning could not start.'),
    });
  };

  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[uiStyles.scroll, { paddingTop: insets.top + 16 }]}
        bottomOffset={64}
        keyboardDismissMode="interactive"
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.kicker, { color: colors.primary }]}>AETHERION CLOUD</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Create server</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>A private host for a friend, event, or test world.</Text>
          </View>
          <View style={[styles.toolboxIcon, { backgroundColor: colors.accent }]}><Feather name="cloud-lightning" size={20} color={colors.primary} /></View>
        </View>

        <View style={[styles.securityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.securityIcon, { backgroundColor: colors.accent }]}><Feather name="shield" size={17} color={colors.primary} /></View>
          <View style={styles.flex}>
            <Text style={[styles.securityTitle, { color: colors.foreground }]}>Backend-secured provisioning</Text>
            <Text style={[styles.securityCopy, { color: colors.mutedForeground }]}>Your phone never receives Hetzner credentials. Hosts are deleted automatically if setup fails.</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: options?.configured ? colors.accent : colors.secondary }]}>
            <Text style={[styles.statusText, { color: options?.configured ? colors.success : colors.warning }]}>{options?.configured ? 'READY' : 'SETUP'}</Text>
          </View>
        </View>

        {job ? <ProgressCard job={job} /> : (
          <>
            <SectionTitle title="Server details" eyebrow="STEP 1 OF 2" />
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>SERVER NAME</Text>
              <TextInput
                testID="server-name-input"
                value={name}
                onChangeText={setName}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={32}
                placeholder="friends-survival"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }]}
              />
              <ChoiceField label="MINECRAFT VERSION" field="version" choices={options?.versions ?? []} value={version} onChange={setVersion} />
              <ChoiceField label="SERVER TYPE" field="serverType" choices={options?.serverTypes ?? []} value={serverType} onChange={(value) => setServerType(value as ProvisioningInputServerType)} />
              <ChoiceField label="REGION" field="region" choices={options?.regions ?? []} value={region} onChange={(value) => setRegion(value as ProvisioningInputRegion)} />
            </View>

            <SectionTitle title="Host capacity" eyebrow="STEP 2 OF 2" />
            <View style={styles.sizeGrid}>
              {(options?.sizes ?? []).map((hostSize) => (
                <Pressable
                  testID={`size-${hostSize.value}`}
                  key={hostSize.value}
                  onPress={() => setSize(hostSize.value as ProvisioningInputSize)}
                  style={({ pressed }) => [
                    styles.sizeCard,
                    { backgroundColor: size === hostSize.value ? colors.accent : colors.card, borderColor: size === hostSize.value ? colors.primary : colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="server" size={17} color={size === hostSize.value ? colors.primary : colors.mutedForeground} />
                  <Text style={[styles.sizeRam, { color: colors.foreground }]}>{hostSize.ramGb} GB</Text>
                  <Text style={[styles.sizeCpu, { color: colors.mutedForeground }]}>{hostSize.cpu} vCPU</Text>
                </Pressable>
              ))}
            </View>

            {error ? <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.destructive }]}><Feather name="alert-circle" size={16} color={colors.destructive} /><Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text></View> : null}
            {!options?.configured && !optionsQuery.isLoading ? <Text style={[styles.setupCopy, { color: colors.warning }]}>Add HETZNER_API_TOKEN to the API server secrets before creating a host.</Text> : null}
            <PrimaryButton
              label={createJob.isPending ? 'Starting provisioning…' : 'Create dedicated server'}
              icon="plus"
              disabled={!options?.configured || optionsQuery.isLoading || createJob.isPending}
              onPress={submit}
            />
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function ChoiceField({ label, choices, value, onChange }: { label: string; field: Field; choices: ProvisioningChoice[]; value: string; onChange: (value: string) => void }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.choiceRow}>
        {choices.map((choice) => (
          <Pressable
            key={choice.value}
            onPress={() => onChange(choice.value)}
            style={({ pressed }) => [
              styles.choice,
              { backgroundColor: value === choice.value ? colors.primary : colors.secondary, borderColor: value === choice.value ? colors.primary : colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.choiceText, { color: value === choice.value ? colors.primaryForeground : colors.mutedForeground }]}>{choice.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ProgressCard({ job }: { job: ProvisioningJob }) {
  const colors = useColors();
  const failed = job.status === 'failed';
  const ready = job.status === 'ready';
  return (
    <>
      <SectionTitle title={ready ? 'Server ready' : failed ? 'Setup rolled back' : 'Building your server'} eyebrow="LIVE PROGRESS" />
      <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: failed ? colors.destructive : ready ? colors.success : colors.border }]}>
        <View style={styles.progressTop}>
          <View><Text style={[styles.progressName, { color: colors.foreground }]}>{job.name}</Text><Text style={[styles.progressMessage, { color: colors.mutedForeground }]}>{job.message}</Text></View>
          <Text style={[styles.progressPercent, { color: failed ? colors.destructive : colors.primary }]}>{job.progress}%</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}><View style={[styles.progressFill, { width: `${job.progress}%`, backgroundColor: failed ? colors.destructive : ready ? colors.success : colors.primary }]} /></View>
        <View style={styles.steps}>
          {job.steps.map((step) => {
            const icon = step.state === 'complete' ? 'check-circle' : step.state === 'failed' ? 'x-circle' : step.state === 'active' ? 'loader' : 'circle';
            const tint = step.state === 'complete' ? colors.success : step.state === 'failed' ? colors.destructive : step.state === 'active' ? colors.primary : colors.mutedForeground;
            return <View key={step.key} style={styles.step}><Feather name={icon} size={17} color={tint} /><Text style={[styles.stepText, { color: step.state === 'pending' ? colors.mutedForeground : colors.foreground }]}>{step.label}</Text></View>;
          })}
        </View>
        {job.publicIp ? <View style={[styles.address, { backgroundColor: colors.secondary }]}><Text style={[styles.addressLabel, { color: colors.mutedForeground }]}>PUBLIC ADDRESS</Text><Text selectable style={[styles.addressValue, { color: colors.foreground }]}>{job.publicIp}:25565</Text></View> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 5 },
  toolboxIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  securityCard: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 19, padding: 14 },
  securityIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  securityTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  securityCopy: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15, marginTop: 3 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 0.7 },
  formCard: { borderWidth: 1, borderRadius: 21, padding: 15, gap: 17 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.2, marginBottom: 7 },
  input: { height: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  field: { gap: 1 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  choiceText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  sizeGrid: { flexDirection: 'row', gap: 9, marginBottom: 18 },
  sizeCard: { flex: 1, borderWidth: 1, borderRadius: 17, padding: 13, gap: 4 },
  sizeRam: { fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 6 },
  sizeCpu: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  errorCard: { flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderRadius: 13, padding: 12, marginBottom: 12 },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16 },
  setupCopy: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16, textAlign: 'center', marginBottom: 12 },
  progressCard: { borderWidth: 1, borderRadius: 22, padding: 17 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  progressName: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  progressMessage: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4, maxWidth: 245 },
  progressPercent: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  progressTrack: { height: 7, borderRadius: 5, overflow: 'hidden', marginVertical: 18 },
  progressFill: { height: '100%', borderRadius: 5 },
  steps: { gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  address: { marginTop: 18, borderRadius: 13, padding: 12 },
  addressLabel: { fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 1.1 },
  addressValue: { fontFamily: 'Inter_700Bold', fontSize: 14, marginTop: 4 },
});
