import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { uiStyles } from '@/components/ControlUI';
import { useControlAuth } from '@/context/ControlAuth';

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unlockWithCode, unlockWithApiKey } = useControlAuth();
  const [code, setCode] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [base, setBase] = useState('http://135.181.18.162:5055');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submitCode = async () => {
    setNotice(null);
    setBusy(true);
    try {
      await unlockWithCode(code);
      router.replace('/(tabs)' as never);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitAdvanced = async () => {
    setNotice(null);
    setBusy(true);
    try {
      await unlockWithApiKey(base, key);
      router.replace('/(tabs)' as never);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 42, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          style={styles.brand}
          onLongPress={() => setAdvanced((value) => !value)}
          delayLongPress={700}
        >
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
            <Text style={[styles.brandMarkText, { color: colors.primaryForeground }]}>A</Text>
          </View>
          <Text style={[styles.brandName, { color: colors.foreground }]}>AETHERION</Text>
        </Pressable>
        <Text style={[styles.kicker, { color: colors.primary }]}>CONTROL ACCESS</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Enter your code.</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Type the access code you were given, then unlock.
        </Text>
        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Access code</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            placeholder="YOUR-CODE"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, styles.codeInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
            onSubmitEditing={() => void submitCode()}
          />
          {notice ? <Text style={[styles.notice, { color: colors.destructive }]}>{notice}</Text> : null}
          <Pressable
            disabled={busy}
            onPress={() => void submitCode()}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.primary, opacity: busy ? 0.45 : 1 },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
              {busy ? 'Connecting…' : 'Unlock'}
            </Text>
          </Pressable>

          {advanced ? (
            <View style={{ gap: 10, marginTop: 18 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>API Base URL</Text>
              <TextInput
                value={base}
                onChangeText={setBase}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              />
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Control API Key</Text>
              <TextInput
                value={key}
                onChangeText={setKey}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              />
              <Pressable
                disabled={busy}
                onPress={() => void submitAdvanced()}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: colors.secondary, opacity: busy ? 0.45 : 1 },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.foreground }]}>Unlock with API key</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 56 },
  brandMark: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  brandName: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.8 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 9 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: -1.2 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 320 },
  form: { gap: 10, marginTop: 32 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 8 },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  codeInput: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  notice: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 4 },
  button: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
});
