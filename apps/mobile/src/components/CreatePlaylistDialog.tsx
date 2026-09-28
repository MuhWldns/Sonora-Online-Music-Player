import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createPlaylist } from '../api/client';
import { Icon } from './Icon';
import { radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

const MAX_TITLE_LENGTH = 150;

function playlistErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('proxy 401')) {
    return 'Sesi akun tidak lagi valid. Perbarui cookie di Settings lalu coba lagi.';
  }
  if (message.startsWith('proxy 400')) {
    return 'Nama playlist tidak valid.';
  }
  return 'Playlist belum dapat dibuat. Periksa koneksi lalu coba lagi.';
}

export function CreatePlaylistDialog({
  visible,
  palette,
  onClose,
  onCreated,
}: {
  visible: boolean;
  palette: Palette;
  onClose: () => void;
  onCreated: (playlistId: string, title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setTitle('');
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createPlaylist(trimmed);
      AccessibilityInfo.announceForAccessibility(`Playlist ${trimmed} dibuat`);
      onCreated(result.playlistId, trimmed);
    } catch (caught) {
      setError(playlistErrorMessage(caught));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.scrim, { backgroundColor: palette.scrim }]}
      >
        <View
          accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: palette.surface }]}
        >
          <View style={styles.titleRow}>
            <View style={[styles.iconWell, { backgroundColor: palette.surfaceVariant }]}>
              <Icon name="playlist-add" size={24} color={palette.accentText} />
            </View>
            <View style={styles.headingCopy}>
              <Text style={[styles.title, { color: palette.text }]}>Playlist baru</Text>
              <Text style={[styles.subtitle, { color: palette.textSecondary }]}>Pribadi di akun YouTube Musicmu</Text>
            </View>
          </View>

          <TextInput
            autoFocus
            value={title}
            onChangeText={(value) => {
              setTitle(value);
              if (error) setError(null);
            }}
            editable={!submitting}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Nama playlist"
            placeholderTextColor={palette.textSecondary}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel="Nama playlist baru"
            style={[
              styles.input,
              {
                color: palette.text,
                backgroundColor: palette.surfaceVariant,
                borderColor: error ? palette.error : palette.outline,
              },
            ]}
          />
          <View style={styles.inputMeta}>
            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.error, { color: palette.error }]}
              >
                {error}
              </Text>
            ) : (
              <View style={styles.metaSpacer} />
            )}
            <Text style={[styles.count, { color: palette.textSecondary }]}>
              {[...title].length}/{MAX_TITLE_LENGTH}
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={close}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Batal membuat playlist"
              style={({ pressed }) => [
                styles.action,
                pressed && styles.pressed,
                submitting && styles.disabled,
              ]}
            >
              <Text style={[styles.secondaryLabel, { color: palette.accentText }]}>Batal</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!title.trim() || submitting}
              accessibilityRole="button"
              accessibilityLabel="Buat playlist"
              accessibilityState={{ disabled: !title.trim() || submitting, busy: submitting }}
              style={({ pressed }) => [
                styles.action,
                styles.primary,
                { backgroundColor: palette.accent },
                pressed && styles.pressed,
                (!title.trim() || submitting) && styles.disabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={palette.onAccent} />
              ) : (
                <Text style={[styles.primaryLabel, { color: palette.onAccent }]}>Buat</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWell: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: { flex: 1, gap: 2 },
  title: { fontSize: typeScale.titleLarge, fontWeight: '800', letterSpacing: -0.2 },
  subtitle: { fontSize: typeScale.label, lineHeight: 18 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    fontSize: typeScale.body,
  },
  inputMeta: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: -spacing.sm },
  metaSpacer: { flex: 1 },
  error: { flex: 1, fontSize: typeScale.label, lineHeight: 18 },
  count: { fontSize: typeScale.small, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  action: {
    minWidth: 72,
    minHeight: 48,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { minWidth: 92 },
  secondaryLabel: { fontSize: typeScale.body, fontWeight: '700' },
  primaryLabel: { fontSize: typeScale.body, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
