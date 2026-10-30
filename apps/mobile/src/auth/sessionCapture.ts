/**
 * Capture sesi YouTube Music dari WebView login (pola BitChord).
 *
 * Cookie kritis YouTube (SID, HSID, SSID, SAPISID, API_SID, …) semuanya
 * HttpOnly — tidak terbaca lewat document.cookie dari JS halaman. Karena itu
 * cookie diangkat dari cookie jar native WebView via @react-native-cookies
 * (useWebKit = true supaya membaca jar yang SAMA dengan <WebView>, bukan jar
 * OkHttp milik fetch).
 *
 * Identitas (pageId/dll) dibaca dari window.ytcfg halaman live, bukan dari
 * fetch ulang — channel mana yang sedang tampil adalah keadaan halaman itu
 * sendiri; inilah yang membuat "pilih channel, lalu simpan" bekerja.
 *
 * Catatan build: kedua dependency native ter-autolink oleh Expo saat build
 * berikutnya dari apps/mobile/android — tidak ada langkah linking manual.
 */
import { Platform } from 'react-native';
import CookieManager from '@react-native-cookies/cookies';

/** Login Google dengan target akhir music.youtube.com — sama seperti pola
 *  BitChord: prompt=select_account supaya user eksplisit memilih akun. */
export const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin' +
  '?ltmpl=music&service=youtube&prompt=select_account' +
  '&continue=https%3A%2F%2Fmusic.youtube.com%2F';

/** Identitas yang diangkat dari window.ytcfg halaman live. */
export interface CapturedIdentity {
  loggedIn: boolean;
  /** DELEGATED_SESSION_ID — identitas brand channel (dikirim sebagai x-yt-user). */
  pageId: string | null;
  /** DATASYNC_ID — fallback identitas personal (tidak dikirim ke proxy saat ini). */
  dataSyncId: string | null;
  /** SESSION_INDEX — akun Google ke-berapa di cookie jar. */
  authUser: string | null;
  /** VISITOR_DATA — tidak disimpan: proxy resolve sendiri via sw.js_data. */
  visitorData: string | null;
}

/** Probe ytcfg — dikirim sebagai OBJECT (bukan string) lewat postMessage agar
 *  tidak double-encode di jembatan RN; handler memilah pesan via `type`. */
export const YTCFG_PROBE = `(function(){
  try {
    var g = function(k){
      try { var v = window.ytcfg && window.ytcfg.get ? window.ytcfg.get(k) : null; return v == null ? null : String(v); }
      catch (e) { return null; }
    };
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'ytcfg',
      loggedIn: String(!!(window.ytcfg && window.ytcfg.get && window.ytcfg.get('LOGGED_IN'))),
      pageId: g('DELEGATED_SESSION_ID'),
      dataSyncId: g('DATASYNC_ID'),
      authUser: g('SESSION_INDEX'),
      visitorData: g('VISITOR_DATA')
    }));
  } catch (e) {}
})(); true;`;

const GOOGLE_ORIGINS = [
  'https://music.youtube.com',
  'https://www.youtube.com',
  'https://youtube.com',
  'https://accounts.google.com',
  'https://www.google.com',
];

const EXPIRED = new Date(0).toISOString();

/** Bersihkan cookie Google/YouTube dari jar WebView, per nama (best-effort).
 *
 * Pelajaran BitChord: jar yang masih memuat sesi lama membuat halaman login
 * langsung ter-redirect ke music.youtube.com — "login yang tidak bisa dipakai
 * login". iOS punya clearByName; Android tidak, jadi cookie di-expire dengan
 * menimpanya memakai tanggal kedaluwarsa masa lalu (berlaku di kedua platform).
 * Cookie non-Google di jar yang sama (mis. login lain) sengaja tidak disentuh. */
export async function clearGoogleWebCookies(): Promise<void> {
  for (const origin of GOOGLE_ORIGINS) {
    let jar: Record<string, { name?: string }> = {};
    try {
      jar = await CookieManager.get(origin, true);
    } catch {
      continue; // jar tak terbaca untuk origin ini — lanjut origin berikutnya
    }
    for (const key of Object.keys(jar)) {
      const name = jar[key]?.name ?? key;
      try {
        if (Platform.OS === 'ios') {
          await CookieManager.clearByName(origin, name, true);
        } else {
          await CookieManager.set(origin, { name, value: '', expires: EXPIRED }, true);
        }
      } catch {
        // best-effort: gagal expire satu nama bukan alasan membatalkan logout
      }
    }
  }
  if (Platform.OS === 'android') {
    try {
      await CookieManager.flush();
    } catch {
      // flush gagal tetap lanjut — cookie tetap ter-expire di memori
    }
  }
}

/** Baca seluruh cookie music.youtube.com dari jar WebView sebagai header
 *  `name=value; …`. Return null kalau kosong atau TIDAK memuat API_SID —
 *  cookie tanpa API_SID tidak bisa menandatangani request API, menyimpannya
 *  hanya membuat sesi yang terlihat login tapi tidak bisa dipakai. */
export async function readYoutubeCookieHeader(): Promise<string | null> {
  let jar: Record<string, { name?: string; value?: string }>;
  try {
    jar = await CookieManager.get('https://music.youtube.com', true);
  } catch {
    return null;
  }
  const entries = Object.entries(jar);
  if (!entries.length) return null;

  const names = new Set(entries.map(([k, c]) => c?.name ?? k));
  if (!names.has('API_SID')) return null;

  const header = entries.map(([k, c]) => `${c?.name ?? k}=${c?.value ?? ''}`).join('; ');
  return header.length > 0 ? header : null;
}
