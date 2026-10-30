/**
 * Settings: proxy URL + cookie management with clear connection feedback.
 * Non-developer users paste these values — every action confirms state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import {
  DEFAULT_PROXY_BASE,
  authSession,
  clearCookie,
  clearUserChannel,
  getCookie,
  getProxyBase,
  healthz,
  setProxyBase,
  setUserChannel,
} from '../api/client';
import { clearGoogleWebCookies } from '../auth/sessionCapture';
import type { RootStackParamList } from '../navigation/types';
import type { AuthSessionResponse } from '../api/types';
import { radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; base: string }
  | { kind: 'fail'; reason: string };

export function SettingsScreen({ palette }: { palette: Palette }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [proxyUrl, setProxyUrl] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const insets = useSafeAreaInsets();

  /** Validasi cookie + ambil profil/channel lewat /auth/session.
   *  401 dari server = cookie invalid → pesan eksplisit untuk user. */
  const fetchSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const result = await authSession();
      setSession(result);
      setSessionError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSession(null);
      setSessionError(
        msg.startsWith('proxy 401')
          ? 'Cookie tidak valid. Hapus lalu login ulang dengan Google.'
          : 'Tidak bisa memuat profil akun. Periksa koneksi proxy.',
      );
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    getProxyBase().then(setProxyUrl);
    // Cookie lama yang sudah tersimpan divalidasi sekali saat masuk Settings.
    getCookie().then((c) => {
      setHasCookie(!!c);
      if (c) void fetchSession();
    });
  }, [fetchSession]);

  /** Sesi disegarkan tiap layar fokus: setelah LoginScreen menutup sendiri
   *  (auto-capture ala BitChord), profil & channel tampil tanpa perlu buka
   *  ulang Settings. */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getCookie().then((c) => {
        if (!alive) return;
        setHasCookie(!!c);
        if (c) void fetchSession();
      });
      return () => {
        alive = false;
      };
    }, [fetchSession]),
  );

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

  /** Logout: hapus sesi tersimpan + pilihan channel + jar WebView native.
   *  Jar harus ikut dibersihkan per cookie Google — kalau tidak, layar login
   *  berikutnya langsung ter-redirect dengan sesi lama (bug "login yang tidak
   *  bisa dipakai login" ala BitChord). */
  const logout = useCallback(async () => {
    await clearCookie();
    await clearUserChannel();
    await clearGoogleWebCookies().catch(() => undefined);
    setHasCookie(false);
    setSession(null);
    setSessionError(null);
    flash('Logout berhasil');
  }, [flash]);

  /** Pilih channel (x-yt-user). id null = akun utama = hapus pageId tersimpan.
   *  Setelah pilih, sesi di-fetch ulang supaya state `selected` selalu
   *  mencerminkan keputusan server, bukan asumsi client. */
  const pickChannel = useCallback(
    async (id: string | null, name: string) => {
      try {
        if (id === null) await clearUserChannel();
        else await setUserChannel(id);
        flash(id === null ? 'Akun utama dipakai' : `Channel: ${name}`);
        void fetchSession();
      } catch {
        flash('Gagal menyimpan channel');
      }
    },
    [flash, fetchSession],
  );

  /** Daftar channel untuk picker. Hanya muncul bila ada lebih dari satu
   *  pilihan. Kalau server tidak mengirim entri akun utama (id null), tambahkan
   *  satu opsi sintetis "Akun utama" supaya user selalu bisa kembali ke default
   *  (tanpa header x-yt-user). */
  const channelOptions = useMemo(() => {
    if (!session) return [];
    const list = [...session.channels];
    if (list.length > 1 && !list.some((c) => c.id === null)) {
      list.unshift({
        id: null,
        name: 'Akun utama',
        thumbnail: null,
        selected: !list.some((c) => c.selected),
      });
    }
    return list;
  }, [session]);

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
            ? 'Sesi tersimpan di perangkat ini. Server tidak pernah menyimpannya.'
            : 'Login dengan akun Google untuk mengisi library, history, dan rekomendasi. Tanpa login: search & home tetap jalan.'}
        </Text>
        {hasCookie ? (
          <View style={styles.actions}>
            <Pressable
              onPress={logout}
              accessibilityRole="button"
              accessibilityLabel="Logout dari akun"
              style={({ pressed }) => [styles.btnTonal, pressed && { opacity: 0.7 }, { backgroundColor: palette.surfaceVariant }]}
            >
              <Text style={[styles.btnTonalText, { color: palette.error }]}>Logout</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Satu-satunya jalur login: WebView Google — cookie diangkat
                otomatis dari sesi yang benar-benar valid (API_SID wajib ada). */}
            <Pressable
              onPress={() => navigation.navigate('Login')}
              accessibilityRole="button"
              accessibilityLabel="Masuk dengan Google"
              style={({ pressed }) => [styles.btnPrimary, pressed && { opacity: 0.7 }, { backgroundColor: palette.accent }]}
            >
              <Text style={[styles.btnPrimaryText, { color: palette.onAccent }]}>Masuk dengan Google</Text>
            </Pressable>
          </>
        )}
        {hasCookie && sessionLoading ? (
          <ActivityIndicator color={palette.accent} style={styles.testResult} />
        ) : null}
        {hasCookie && session ? (
          <>
            <View style={[styles.profileRow, { backgroundColor: palette.surfaceVariant }]}>
              {session.profile.thumbnail ? (
                <Image
                  source={{ uri: session.profile.thumbnail }}
                  style={styles.avatar}
                  accessibilityLabel={undefined}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.surface }]}>
                  <Icon name="account-circle" size={24} color={palette.textSecondary} />
                </View>
              )}
              <View style={styles.profileMeta}>
                <Text numberOfLines={1} style={[styles.profileName, { color: palette.text }]}>
                  {session.profile.name}
                </Text>
                {session.profile.email ? (
                  <Text numberOfLines={1} style={[styles.profileEmail, { color: palette.textSecondary }]}>
                    {session.profile.email}
                  </Text>
                ) : null}
              </View>
            </View>
            {channelOptions.length > 1 ? (
              <View>
                <Text style={[styles.channelTitle, { color: palette.text }]}>Channel</Text>
                {channelOptions.map((channel) => (
                  <Pressable
                    key={channel.id ?? '__main__'}
                    onPress={() => void pickChannel(channel.id, channel.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Pakai channel ${channel.name}`}
                    accessibilityState={{ selected: channel.selected }}
                    style={({ pressed }) => [
                      styles.channelRow,
                      { backgroundColor: palette.surfaceVariant },
                      channel.selected && { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.accent },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    {channel.thumbnail ? (
                      <Image source={{ uri: channel.thumbnail }} style={styles.channelAvatar} accessibilityLabel={undefined} />
                    ) : (
                      <View style={[styles.channelAvatar, styles.avatarFallback, { backgroundColor: palette.surface }]}>
                        <Icon name="music-note" size={18} color={palette.textSecondary} />
                      </View>
                    )}
                    <Text numberOfLines={1} style={[styles.channelName, { color: palette.text }]}>
                      {channel.name}
                    </Text>
                    {channel.selected ? (
                      <Icon name="check-circle" size={18} color={palette.accent} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        {hasCookie && !sessionLoading && sessionError ? (
          <View style={[styles.testRow, { backgroundColor: palette.surfaceVariant }]}>
            <Icon name="error-outline" size={18} color={palette.error} />
            <Text style={[styles.testText, { color: palette.error }]}>{sessionError}</Text>
          </View>
        ) : null}
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
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  profileMeta: { flex: 1, gap: 2 },
  profileName: { fontSize: typeScale.body, fontWeight: '700' },
  profileEmail: { fontSize: typeScale.label },
  channelTitle: { fontSize: typeScale.label, fontWeight: '700', marginTop: spacing.sm },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  channelAvatar: { width: 36, height: 36, borderRadius: 18 },
  channelName: { flex: 1, fontSize: typeScale.body, fontWeight: '600' },
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
