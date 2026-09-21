import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

type Props = {
  visible: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void;
};

export function NameEditorModal({ visible, initialName, onClose, onSave }: Props) {
  const colors = useColors();
  const [value, setValue] = useState(initialName);

  useEffect(() => {
    if (visible) setValue(initialName);
  }, [initialName, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => undefined}>
          <Text style={[styles.title, { color: colors.foreground }]}>Welcome name</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>How the app greets you — friends can set their own name after unlock.</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            maxLength={24}
            placeholder="z.B. Robbi"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <View style={styles.row}>
            <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onSave(value);
                onClose();
              }}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,7,13,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, borderRadius: 20, borderWidth: 1, padding: 18 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.4 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 14 },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontFamily: 'Inter_500Medium', fontSize: 15 },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
});
