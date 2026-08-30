/**
 * Settings: proxy URL + cookie management with clear connection feedback.
 * Non-developer users paste these values — every action confirms state.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import {
  DEFAULT_PROXY_BASE,
  clearCookie,
  getCookie,
  getProxyBase,
  healthz,
  setCookie,
  setProxyBase,
} from '../api/client';
import { radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; base: string }
  | { kind: 'fail'; reason: string };

export function SettingsScreen({ palette }: { palette: Palette }) {
  const [proxyUrl, setProxyUrl] = useState('');
  const [cookie, setCookieField] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    getProxyBase().then(setProxyUrl);
    getCookie().then((c) => setHasCookie(!!c));
  }, []);

  const runTest = useCallback(async (base: string) => {
    setTest({ kind: 'testing' });
    try {
      const normalized = base.trim().replace(/\/+$/, '') || DEFAULT_PROXY_BASE;
      await healthz(normalized);
      setTest({ kind: 'ok', base: normalized });
    } catch (e) {
      setTest({
        kind: 'fail',
        reason: e instanceof Error ? e.message : 'Tidak bisa menghubungi proxy',
      });
    }
  }, []);

  const flash = useCallback((msg: string) => {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash(null), 2000);
  }, []);

  const saveProxy = useCallback(async () => {
    await setProxyBase(proxyUrl);
    flash('Proxy tersimpan');
  }, [proxyUrl, flash]);

  const saveCookie = useCallback(async () => {
    const trimmed = cookie.trim();
    if (!trimmed) return;
    await setCookie(trimmed);
    setCookieField('');
    setHasCookie(true);
    flash('Cookie tersimpan');
  }, [cookie, flash]);

  const removeCookie = useCallback(async () => {
    await clearCookie();
    setHasCookie(false);
    flash('Cookie dihapus');
  }, [flash]);

  return (
    <ScrollView
      style={{ backgroundColor: palette.background, flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: 200, gap: spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: palette.text }]}>Settings</Text>

      {/* Proxy */}
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: palette.text }]}>Server proxy</Text>
        <Text style={[styles.groupHint, { color: palette.textSecondary }]}>
          Alamat proxy Sonora milikmu. Default: {DEFAULT_PROXY_BASE}
        </Text>
        <TextInput
          value={proxyUrl}
          onChangeText={setProxyUrl}
          placeholder="http://host:port"
          placeholderTextColor={palette.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, { color: palette.text, borderColor: palette.outline, backgroundColor: palette.surface }]}
          accessibilityLabel="Alamat proxy"
        />
        <View style={styles.actions}>
          <Pressable
            onPress={saveProxy}
            accessibilityRole="button"
            accessibilityLabel="Simpan alamat proxy"
            style={({ pressed }) => [styles.btnPrimary, pressed && { opacity: 0.7 }, { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.btnPrimaryText, { color: palette.onAccent }]}>Simpan</Text>
          </Pressable>
          <Pressable
            onPress={() => runTest(proxyUrl)}
            accessibilityRole="button"
            accessibilityLabel="Tes koneksi proxy"
            style={({ pressed }) => [styles.btnTonal, pressed && { opacity: 0.7 }, { backgroundColor: palette.surfaceVariant }]}
          >
            <Text style={[styles.btnTonalText, { color: palette.text }]}>Tes koneksi</Text>
          </Pressable>
        </View>
        {test.kind === 'testing' && <ActivityIndicator color={palette.accent} style={styles.testResult} />}
        {test.kind === 'ok' && (
          <View style={[styles.testRow, { backgroundColor: palette.surfaceVariant }]}>
            <Icon name="check-circle" size={18} color="#2E7D32" />
            <Text style={[styles.testText, { color: palette.text }]}>
              Terhubung — {test.base}
            </Text>
          </View>
        )}
        {test.kind === 'fail' && (
          <View style={[styles.testRow, { backgroundColor: palette.surfaceVariant }]}>
            <Icon name="error-outline" size={18} color={palette.error} />
            <Text style={[styles.testText, { color: palette.error }]}>
              Gagal: {test.reason}
            </Text>
          </View>
        )}
      </View>

      {/* Cookie */}
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: palette.text }]}>Akun YouTube Music</Text>
        <Text style={[styles.groupHint, { color: palette.textSecondary }]}>
          {hasCookie
            ? 'Cookie tersimpan di perangkat ini. Server tidak pernah menyimpannya.'
            : 'Login dengan cookie dari browser tempat kamu sudah login ke music.youtube.com. Tanpa cookie: search & home tetap jalan; library butuh login.'}
        </Text>
        {hasCookie ? (
          <View style={styles.actions}>
            <Pressable
              onPress={removeCookie}
              accessibilityRole="button"
              accessibilityLabel="Hapus cookie"
              style={({ pressed }) => [styles.btnTonal, pressed && { opacity: 0.7 }, { backgroundColor: palette.surfaceVariant }]}
            >
              <Text style={[styles.btnTonalText, { color: palette.error }]}>Hapus cookie</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              value={cookie}
              onChangeText={setCookieField}
              placeholder="Tempel cookie di sini…"
              placeholderTextColor={palette.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={[styles.input, styles.cookieInput, { color: palette.text, borderColor: palette.outline, backgroundColor: palette.surface }]}
              accessibilityLabel="Cookie YouTube"
            />
            <View style={styles.actions}>
              <Pressable
                onPress={saveCookie}
                disabled={!cookie.trim()}
                accessibilityRole="button"
                accessibilityLabel="Simpan cookie"
                style={({ pressed }) => [
                  styles.btnPrimary,
                  pressed && { opacity: 0.7 },
                  !cookie.trim() && { opacity: 0.4 },
                  { backgroundColor: palette.accent },
                ]}
              >
                <Text style={[styles.btnPrimaryText, { color: palette.onAccent }]}>Simpan cookie</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {savedFlash && (
        <View style={[styles.flash, { backgroundColor: palette.surfaceVariant }]}>
          <Icon name="check-circle" size={18} color="#2E7D32" />
          <Text style={[styles.testText, { color: palette.text }]}>{savedFlash}</Text>
        </View>
      )}

      <Text style={[styles.footer, { color: palette.textSecondary }]}>
        Sonora • proxy stateless • cookie hanya tersimpan di keychain perangkat ini
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typeScale.display, fontWeight: '800', letterSpacing: -0.5, paddingHorizontal: spacing.lg },
  group: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  groupTitle: { fontSize: typeScale.title, fontWeight: '700' },
  groupHint: { fontSize: typeScale.label, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: typeScale.body,
    minHeight: 48,
  },
  cookieInput: { minHeight: 96, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btnPrimary: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 24,
  },
  btnPrimaryText: { fontSize: typeScale.body, fontWeight: '700' },
  btnTonal: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 24,
  },
  btnTonalText: { fontSize: typeScale.body, fontWeight: '600' },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  testText: { fontSize: typeScale.label, flex: 1 },
  testResult: { paddingVertical: spacing.sm },
  flash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
  },
  footer: { fontSize: typeScale.small, textAlign: 'center', paddingTop: spacing.xl },
});
