/**
 * Login YouTube Music via WebView in-app.
 *
 * Alur: bersihkan cookie Google di jar WebView → buka halaman login Google
 * yang berakhir di music.youtube.com → baca ytcfg halaman live → angkat cookie
 * dari jar native (API_SID wajib ada) → simpan ke keychain → validasi via
 * /auth/session.
 *
 * Capture dilakukan reaktif saat halaman music.youtube.com terdeteksi, TAPI
 * juga tersedia tombol manual "Simpan sesi sekarang" — auto-capture penuh
 * pernah jadi sumber race di BitChord (profil palsu yang menutup layar too
 * soon), jadi pengguna tetap punya kendali.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { Icon } from '../components/Icon';
import { authSession, clearCookie, clearUserChannel, setCookie, setUserChannel } from '../api/client';
import {
  LOGIN_URL,
  YTCFG_PROBE,
  clearGoogleWebCookies,
  readYoutubeCookieHeader,
  type CapturedIdentity,
} from '../auth/sessionCapture';
import { radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Phase = 'preparing' | 'browsing' | 'saving' | 'done' | 'error';

/** Domain yang boleh dimuat — login Google menyentuh subdomain ini saja;
 *  sisanya ditolak supaya redirect tak terduga tidak membawa sesi keluar. */
const ALLOWED_HOST_SUFFIXES = [
  'google.com',
  'youtube.com',
  'googleusercontent.com',
  'gstatic.com',
  'googlevideo.com',
];

function hostAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false; // URL tidak valid (mis. about:blank) — blok saja
  }
}

function hostIsMusic(url: string): boolean {
  try {
    return new URL(url).hostname === 'music.youtube.com';
  } catch {
    return false;
  }
}

export function LoginScreen({ palette }: { palette: Palette }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const webViewRef = useRef<WebView>(null);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [notice, setNotice] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const insets = useSafeAreaInsets();

  /** Bersihkan jar Google dulu supaya akun lain bisa login (jar lama membuat
   *  halaman login langsung melempar ke music.youtube.com tanpa form). */
  useEffect(() => {
    let alive = true;
    clearGoogleWebCookies().finally(() => {
      if (alive) setPhase('browsing');
    });
    return () => {
      alive = false;
    };
  }, []);

  const saveAndValidate = useCallback(async () => {
    setPhase('saving');
    setNotice(null);
    const header = await readYoutubeCookieHeader();
    if (!header) {
      // Belum ada API_SID — sesi belum "menempel". Biarkan user lanjut di
      // WebView; menyimpan sekarang hanya membuat sesi yang gagal nanti.
      setPhase('browsing');
      setNotice('Login belum lengkap — buka music.youtube.com sampai halamannya tampil, lalu simpan.');
      return;
    }
    try {
      await setCookie(header);
    } catch {
      setPhase('error');
      setNotice('Gagal menyimpan cookie ke perangkat.');
      return;
    }
    // pageId (DELEGATED_SESSION_ID) = channel aktif saat capture — disimpan
    // terpisah dari cookie (lewat handleProbe) supaya bisa diganti tanpa login
    // ulang. visitorData sengaja tidak disimpan: proxy resolve sendiri.
    try {
      const session = await authSession();
      setProfileName(session.profile.name);
      setPhase('done');
      setTimeout(() => navigation.goBack(), 1200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('proxy 401')) {
        // Proxy menolak cookie yang baru di-capture → sesinya memang tidak
        // sah; jangan biarkan tersimpan memberi ilusi sudah login.
        await clearCookie().catch(() => undefined);
        await clearUserChannel().catch(() => undefined);
        setPhase('browsing');
        setNotice('Cookie ditolak server — sesi tidak valid. Coba login ulang.');
      } else {
        setPhase('done');
        setNotice('Sesi tersimpan, tapi tidak bisa divalidasi (proxy tidak terjangkau).');
        setTimeout(() => navigation.goBack(), 2500);
      }
    }
  }, [navigation]);

  const handleProbe = useCallback(
    (identity: CapturedIdentity) => {
      if (identity.loggedIn !== true) return;
      // pageId disimpan di sini (bukan di saveAndValidate) karena identitas
      // dibaca halaman live — cookie header dari jar tidak membawanya.
      if (identity.pageId) void setUserChannel(identity.pageId).catch(() => undefined);
      void saveAndValidate();
    },
    [saveAndValidate],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        // Probe mengirim nilai mentah sebagai string — konversi ke tipe kaya
        // terjadi di sini, sebelum menyentuh CapturedIdentity.
        const data = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          loggedIn?: string;
          pageId?: string | null;
          dataSyncId?: string | null;
          authUser?: string | null;
          visitorData?: string | null;
        };
        if (data.type !== 'ytcfg') return; // pesan lain dari halaman — abaikan
        handleProbe({
          loggedIn: data.loggedIn === 'true',
          pageId: data.pageId ?? null,
          dataSyncId: data.dataSyncId ?? null,
          authUser: data.authUser ?? null,
          visitorData: data.visitorData ?? null,
        });
      } catch {
        // bukan JSON dari probe kami — abaikan
      }
    },
    [handleProbe],
  );

  const onNavStateChange = useCallback((state: WebViewNavigation) => {
    if (hostIsMusic(state.url)) webViewRef.current?.injectJavaScript(YTCFG_PROBE);
  }, []);

  const busy = phase === 'preparing' || phase === 'saving';

  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      {/* Bar atas */}
      <View style={[styles.header, { borderBottomColor: palette.outline }]}>
        <Text style={[styles.headerTitle, { color: palette.text }]}>Masuk dengan Google</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Tutup layar login"
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <Icon name="close" size={22} color={palette.text} />
        </Pressable>
      </View>

      {notice ? (
        <View style={[styles.notice, { backgroundColor: palette.surfaceVariant }]}>
          <Icon
            name={phase === 'done' ? 'check-circle' : 'error-outline'}
            size={18}
            color={phase === 'done' ? '#2E7D32' : palette.error}
          />
          <Text style={[styles.noticeText, { color: palette.text }]}>{notice}</Text>
        </View>
      ) : null}

      {phase === 'preparing' ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.hint, { color: palette.textSecondary }]}>Menyiapkan sesi baru…</Text>
        </View>
      ) : null}

      {phase === 'done' ? (
        <View style={styles.center}>
          <Icon name="check-circle" size={48} color="#2E7D32" />
          <Text style={[styles.doneTitle, { color: palette.text }]}>
            {profileName ? `Masuk sebagai ${profileName}` : 'Sesi tersimpan'}
          </Text>
        </View>
      ) : null}

      {(phase === 'browsing' || phase === 'saving' || phase === 'error') && (
        <View style={styles.web}>
          <WebView
            ref={webViewRef}
            source={{ uri: LOGIN_URL }}
            onMessage={onMessage}
            onNavigationStateChange={onNavStateChange}
            onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
            onShouldStartLoadWithRequest={(req) => hostAllowed(req.url)}
            javaScriptEnabled
            domStorageEnabled
            incognito={false}
            style={{ backgroundColor: palette.background }}
          />
          {phase === 'saving' ? (
            <View style={[styles.overlay, { backgroundColor: `${palette.background}CC` }]}>
              <ActivityIndicator color={palette.accent} />
              <Text style={[styles.hint, { color: palette.textSecondary }]}>Menyimpan sesi…</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Bilah bawah: progress + aksi manual */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={[styles.progressTrack, { backgroundColor: palette.surfaceVariant }]}>
          <View style={[styles.progressFill, { backgroundColor: palette.accent, width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <View style={styles.footerActions}>
          <Pressable
            onPress={() => void saveAndValidate()}
            disabled={busy || phase === 'done'}
            accessibilityRole="button"
            accessibilityLabel="Simpan sesi sekarang"
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: palette.accent },
              (busy || phase === 'done') && { opacity: 0.4 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.saveBtnText, { color: palette.onAccent }]}>Simpan sesi sekarang</Text>
          </Pressable>
          {phase === 'error' ? (
            <Pressable
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Kembali"
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }, { backgroundColor: palette.surfaceVariant }]}
            >
              <Text style={[styles.backBtnText, { color: palette.text }]}>Kembali</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: typeScale.title, fontWeight: '700' },
  close: { padding: spacing.sm },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  noticeText: { flex: 1, fontSize: typeScale.label, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  doneTitle: { fontSize: typeScale.title, fontWeight: '700' },
  hint: { fontSize: typeScale.label },
  web: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3 },
  footerActions: { flexDirection: 'row', gap: spacing.sm },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 24,
  },
  saveBtnText: { fontSize: typeScale.body, fontWeight: '700' },
  backBtn: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 24,
  },
  backBtnText: { fontSize: typeScale.body, fontWeight: '600' },
});
