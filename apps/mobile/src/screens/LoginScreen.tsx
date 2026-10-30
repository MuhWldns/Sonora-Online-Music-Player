/**
 * Login YouTube Music via WebView in-app — pola BitChord.
 *
 * WebView penuh layar, tanpa tombol simpan manual: begitu halaman mendarat
 * di music.youtube.com dalam keadaan login (ytcfg LOGGED_IN), cookie diangkat
 * dari jar WebView (API_SID wajib ada), divalidasi via /auth/session, lalu
 * layar menutup sendiri. Capture terlalu dini adalah sumber race di BitChord
 * (profil palsu + tutup too soon), jadi probe ytcfg diulang beberapa kali
 * dan cookie yang sama tidak pernah disimpan dua kali.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { Icon } from '../components/Icon';
import { authSessionWith, upsertAccount } from '../api/client';
import {
  LOGIN_URL,
  YTCFG_PROBE,
  clearGoogleWebCookies,
  readYoutubeCookieHeader,
} from '../auth/sessionCapture';
import { radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

/** Probe ytcfg diulang selama ini sebelum menyerah — cookie & ytcfg bisa
 *  "menempel" beberapa ratus ms setelah halaman land. */
const PROBE_MAX_ATTEMPTS = 5;
const PROBE_RETRY_MS = 1500;

type Phase = 'preparing' | 'browsing' | 'saving' | 'done';

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

interface ProbePayload {
  type?: string;
  loggedIn?: string;
  pageId?: string | null;
  dataSyncId?: string | null;
  authUser?: string | null;
  visitorData?: string | null;
}

export function LoginScreen({ palette }: { palette: Palette }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const webViewRef = useRef<WebView>(null);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const probeAttempts = useRef(0);
  /** Cookie terakhir yang sudah dicoba disimpan — cegah loop simpan ulang
   *  cookie yang sama saat probe diulang. */
  const lastAttemptedCookie = useRef<string | null>(null);
  /** pageId channel dari probe ytcfg — dipakai saat upsert akun (pageId
   *  tersimpan PER AKUN di registry, bukan global). */
  const pageIdRef = useRef<string | null>(null);
  /** Probe sedang dijadwalkan ulang — jangan tumpuk jadwal dari tiap load. */
  const probeScheduled = useRef(false);
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

  const scheduleProbe = useCallback((delayMs = 0) => {
    if (probeScheduled.current) return;
    probeScheduled.current = true;
    setTimeout(() => {
      probeScheduled.current = false;
      webViewRef.current?.injectJavaScript(YTCFG_PROBE);
    }, delayMs);
  }, []);

  const saveAndValidate = useCallback(
    async (header: string) => {
      setPhase('saving');
      setNotice(null);
      try {
        // Validasi dulu — cookie yang ditolak server tidak pernah masuk
        // registry (authSessionWith mengirim cookie eksplisit).
        const session = await authSessionWith(header, pageIdRef.current);
        await upsertAccount({
          id: session.profile.email ?? session.profile.name ?? `login:${Date.now()}`,
          name: session.profile.name || 'Akun',
          thumbnail: session.profile.thumbnail,
          cookie: header,
          pageId: pageIdRef.current,
        });
        setPhase('done');
        // Tutup sendiri ala BitChord — Settings yang menunggu di bawah akan
        // menyegarkan sesi saat focus kembali.
        setTimeout(() => navigation.goBack(), 800);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith('proxy 401')) {
          setNotice('Cookie ditolak server — sesi tidak valid. Coba login ulang.');
          setPhase('browsing');
        } else {
          setNotice('Sesi tidak bisa divalidasi (proxy tidak terjangkau) — coba lagi nanti.');
          setPhase('browsing');
        }
      }
    },
    [navigation],
  );

  const handleProbe = useCallback(
    (payload: ProbePayload) => {
      if (payload.loggedIn !== 'true') return; // belum login — biarkan user di form
      // pageId (DELEGATED_SESSION_ID) = channel aktif saat capture — masuk ke
      // registry bersama akun ini (pageId per akun, bukan global).
      // visitorData sengaja tidak disimpan: proxy resolve sendiri.
      pageIdRef.current = payload.pageId ?? null;

      void (async () => {
        const header = await readYoutubeCookieHeader();
        if (!header) {
          // API_SID belum menempel di jar — coba probe lagi dalam beberapa
          // ratus ms sebelum menyerah (race "too soon" ala BitChord).
          if (probeAttempts.current < PROBE_MAX_ATTEMPTS) {
            probeAttempts.current += 1;
            scheduleProbe(PROBE_RETRY_MS);
          } else {
            setNotice('Login belum lengkap — buka music.youtube.com sampai halamannya tampil.');
          }
          return;
        }
        if (header === lastAttemptedCookie.current) return; // sudah dicoba — jangan loop
        lastAttemptedCookie.current = header;
        await saveAndValidate(header);
      })();
    },
    [saveAndValidate, scheduleProbe],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as ProbePayload;
        if (data.type !== 'ytcfg') return; // pesan lain dari halaman — abaikan
        handleProbe(data);
      } catch {
        // bukan JSON dari probe kami — abaikan
      }
    },
    [handleProbe],
  );

  const onNavStateChange = useCallback(
    (state: WebViewNavigation) => {
      if (hostIsMusic(state.url)) {
        probeAttempts.current = 0; // landing baru — reset kuota retry
        scheduleProbe();
      }
    },
    [scheduleProbe],
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      {/* Bar atas ramping: judul + tutup + garis progres tipis */}
      <View style={[styles.header, { borderBottomColor: palette.outline }]}>
        <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1}>
          {notice ?? 'Masuk dengan Google'}
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Tutup layar login"
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <Icon name={phase === 'done' ? 'check-circle' : 'close'} size={22} color={palette.text} />
        </Pressable>
      </View>
      {phase === 'saving' ? (
        <View style={styles.savingBar}>
          <ActivityIndicator size="small" color={palette.accent} />
          <Text style={[styles.savingText, { color: palette.textSecondary }]}>Menyimpan sesi…</Text>
        </View>
      ) : (
        <View style={[styles.progressTrack, { backgroundColor: palette.surfaceVariant }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: palette.accent, width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
      )}

      {phase === 'preparing' ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.hint, { color: palette.textSecondary }]}>Menyiapkan sesi baru…</Text>
        </View>
      ) : (
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
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: typeScale.body, fontWeight: '700' },
  close: { padding: spacing.sm },
  progressTrack: { height: 2 },
  progressFill: { height: 2 },
  savingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  savingText: { fontSize: typeScale.small },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  hint: { fontSize: typeScale.label },
  web: { flex: 1 },
});
