import { useSSO } from '@clerk/expo';
import { useRouter } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { uiStyles } from '@/components/ControlUI';

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const submit = useCallback(async () => {
    setNotice(null);
    setIsLoading(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'minecraft-server-control' }),
      });
      if (!createdSessionId || !setActive) {
        setNotice('Google-Anmeldung benötigt weitere Bestätigung.');
        return;
      }
      await setActive({ session: createdSessionId });
      router.replace('/(tabs)' as never);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Google-Anmeldung konnte nicht abgeschlossen werden.');
    } finally {
      setIsLoading(false);
    }
  }, [router, startSSOFlow]);

  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 42, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}><View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Text style={[styles.brandMarkText, { color: colors.primaryForeground }]}>A</Text></View><Text style={[styles.brandName, { color: colors.foreground }]}>AETHERION</Text></View>
        <Text style={[styles.kicker, { color: colors.primary }]}>SECURE ACCESS</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Welcome back.</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Melde dich sicher mit deinem Google-Konto an. Kein separates Passwort erforderlich.</Text>
        <View style={styles.form}>
          {notice ? <Text style={[styles.notice, { color: colors.destructive }]}>{notice}</Text> : null}
          <Pressable disabled={isLoading} onPress={submit} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: isLoading ? 0.45 : 1 }, pressed && { opacity: 0.75 }]}>
            <Text style={[styles.googleMark, { color: colors.primaryForeground }]}>G</Text>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{isLoading ? 'Google wird geöffnet…' : 'Mit Google anmelden'}</Text>
          </Pressable>
        </View>
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>Beim ersten Login wird dein AETHERION-Konto automatisch erstellt.</Text>
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
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 300 },
  form: { gap: 16, marginTop: 32 },
  notice: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17 },
  button: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 3 },
  googleMark: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  footer: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', marginTop: 28 },
});
