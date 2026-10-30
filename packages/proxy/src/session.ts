/**
 * Session/context helper ala YouTube — pendamping innertube.ts.
 *
 * Isi modul ini portable (hanya Web Standard API): aman untuk entrypoint
 * Node maupun Cloudflare Worker. Tidak tahu runtime-nya apa — `cache` dan
 * `fetch` selalu di-inject via deps.
 *
 * Kenapa modul terpisah: innertube.ts bicara soal FACTORY instance
 * youtubei.js, sedangkan di sini soal DATA konteks (visitorData, daftar
 * channel brand akun, deteksi error auth) yang hidup di level HTTP mentah
 * sebelum instance InnerTube dibuat.
 */
import type { CacheAdapter } from './cache.js';
import { findAll, findFirst, thumbs } from './parsers.js';

/* ---------------- visitor data ---------------- */

/** TTL cache sukses VISITOR_DATA (6 jam): nilainya stabil per sesi web,
 *  tidak perlu lebih sering. */
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000;
/** TTL marker kegagalan (10 menit): kalau YouTube down / format berubah,
 *  jangan fetch ulang tiap request — biarkan gagal senyap sesaat. */
const VISITOR_FAIL_TTL_MS = 10 * 60 * 1000;

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** sw.js_data adalah script (bukan JSON murni) yang menyematkan ytcfg;
 *  VISITOR_DATA muncul sebagai string JSON yang bisa berisi escape `\"`.
 *  Regex ini menangkap isi string termasuk escape-nya, lalu di-unescape
 *  via JSON.parse. */
const VISITOR_DATA_RE = /"VISITOR_DATA":"((?:[^"\\]|\\.)*)"/;

/**
 * Ambil VISITOR_DATA milik sesi web untuk cookie ini. Tanpa cookie langsung
 * undefined (tidak ada sesi web untuk di-bind, jangan buang network call).
 * Sukses di-cache per scope cookie (hash) 6 jam; KEGAGALAN di-cache sebagai
 * marker 10 menit supaya YouTube yang sedang down tidak mengubah setiap
 * request jadi lambat. Selalu resolve — error ditelan dan dikembalikan
 * sebagai undefined (visitorData hanya enhancer, bukan prasyarat).
 */
export async function resolveVisitorData(
  deps: { cache: CacheAdapter; fetch: typeof fetch },
  cookie?: string,
): Promise<string | undefined> {
  if (!cookie) return undefined;

  const scope = hashScope(cookie);
  const okKey = `yt:visitor:${scope}`;
  const failKey = `yt:visitor-fail:${scope}`;

  const cached = await deps.cache.get<string>(okKey);
  if (cached) return cached;
  // Marker gagal → diamkan saja, jangan fetch ulang selama TTL marker.
  if (await deps.cache.get<boolean>(failKey)) return undefined;

  try {
    const res = await deps.fetch('https://www.youtube.com/sw.js_data', {
      headers: {
        Cookie: cookie,
        'User-Agent': CHROME_UA,
      },
    });
    if (!res.ok) throw new Error(`sw.js_data HTTP ${res.status}`);
    const body = await res.text();
    const m = VISITOR_DATA_RE.exec(body);
    if (!m) throw new Error('VISITOR_DATA tidak ditemukan di sw.js_data');
    // m[1] hanya berisi karakter string-JSON (regex di atas), jadi parse aman.
    const value = JSON.parse(`"${m[1]}"`) as string;
    if (!value) throw new Error('VISITOR_DATA kosong');
    await deps.cache.set(okKey, value, VISITOR_TTL_MS);
    return value;
  } catch {
    await deps.cache.set(failKey, true, VISITOR_FAIL_TTL_MS);
    return undefined;
  }
}

/* ---------------- account profile & channels ---------------- */

export interface AccountProfile {
  name: string;
  email?: string;
  thumbnail: string | null;
}

export interface AccountChannel {
  /** Page ID / delegatedSessionId channel (untuk onBehalfOfUser). Boleh null
   *  bila item akun tidak membawa selectEndpoint. */
  id: string | null;
  name: string;
  thumbnail: string | null;
  selected: boolean;
}

/** Text yang di InnerTube bisa muncul sebagai {content}, {simpleText},
 *  atau {runs:[{text}]}. Dibuat lokal: parsers.text hanya mengenal dua bentuk
 *  terakhir, sedangkan response account web (sw.js_data & account menu)
 *  sering memakai `content`. */
function textContent(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  const o = v as { content?: unknown; simpleText?: unknown; runs?: unknown };
  if (typeof o.content === 'string') return o.content;
  if (typeof o.simpleText === 'string') return o.simpleText;
  if (Array.isArray(o.runs)) {
    return o.runs
      .map((r) => {
        const t = (r as { text?: unknown } | null)?.text;
        return typeof t === 'string' ? t : '';
      })
      .join('');
  }
  return '';
}

/**
 * Profil akun aktif dari response `account/account_menu` (raw InnerTube):
 * cari `activeAccountHeaderRenderer`, ambil name/email/thumbnail.
 * Return undefined kalau renderer tidak ada atau name kosong — caller
 * sebaiknya memperlakukan itu sebagai "tidak bisa membaca profil",
 * bukan error fatal.
 */
export function parseAccountProfile(data: unknown): AccountProfile | undefined {
  const header = findFirst<Record<string, unknown>>(
    data,
    'activeAccountHeaderRenderer',
  );
  if (!header) return undefined;
  const name = textContent(header.accountName);
  if (!name) return undefined;
  const email = textContent(header.email);
  return {
    name,
    email: email || undefined,
    thumbnail: thumbs(header.accountPhoto ?? header.thumbnail),
  };
}

/**
 * Daftar channel/profil akun (untuk pemilih `onBehalfOfUser` di mobile).
 * Response `account/accounts_list` DAN `account/account_menu` sama-sama
 * memuat `accountItemRenderer` — keduanya di-walk supaya tahan terhadap
 * perubahan layout (kalau satu varian hilang, yang lain masih terbaca).
 *
 * - id: pageId (atau delegatedSessionId) dari selectEndpoint di dalam
 *   serviceEndpoint item — inilah nilai yang mobile kirim sebagai
 *   `x-yt-user` / onBehalfOfUser.
 * - selected: field isSelected bila ada; default false.
 * - dedupe berdasarkan id+name: response kadang memuat item akun yang sama
 *   di dua container berbeda, dan duplikat akan membingungkan UI pemilih.
 */
export function parseAccountChannels(data: unknown): AccountChannel[] {
  const scopes: unknown[] = [
    ...findAll(data, 'accounts_list'),
    ...findAll(data, 'account_menu'),
  ];
  const items = scopes.length
    ? scopes.flatMap((s) => findAll<Record<string, unknown>>(s, 'accountItemRenderer'))
    : findAll<Record<string, unknown>>(data, 'accountItemRenderer');

  const seen = new Set<string>();
  const out: AccountChannel[] = [];
  for (const item of items) {
    const name = textContent(item.accountName ?? item.title);
    if (!name) continue;
    // selectEndpoint dicari di seluruh subtree item — posisinya di dalam
    // serviceEndpoint, tapi path persisnya bisa berubah antar layout.
    const sel = findFirst<Record<string, unknown>>(item, 'selectEndpoint');
    const rawId = sel?.pageId ?? sel?.delegatedSessionId;
    const id = typeof rawId === 'string' && rawId ? rawId : null;
    const dedupeKey = `${id ?? ''}|${name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const selectedRaw = item.isSelected;
    out.push({
      id,
      name,
      thumbnail: thumbs(item.accountPhoto ?? item.thumbnail),
      selected: selectedRaw === undefined ? false : Boolean(selectedRaw),
    });
  }
  return out;
}

/* ---------------- auth error detection ---------------- */

/**
 * Heuristic: apakah error ini kemungkinan 401/403 dari InnerTube?
 *
 * Aturan: pesan harus memuat "401" atau "403" sebagai angka tersendiri
 * (bukan bagian dari angka lain, mis. ID video) DAN menyebut HTTP/status —
 * pola pesan youtubei.js semacam "HTTP Error 403: Forbidden" atau
 * "Request failed with status code 401".
 *
 * BATASAN (kenapa heuristic, bukan cek status asli):
 * - error dari youtubei.js biasanya sudah jadi `Error` bertuliskan status;
 *   objek `Response` asli tidak lagi tersedia di titik pemanggilan, jadi
 *   kita tidak bisa membaca res.status secara langsung.
 * - Bisa false negative (pesanea diubah youtubei.js) atau false positive
 *   (teks lain kebetulan memuat "403 ... HTTP"). Pemanggil harus
 *   memperlakukan hasilnya sebagai sinyal retry, bukan kepastian.
 */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /(^|[^0-9])(401|403)([^0-9]|$)/.test(msg) &&
    /HTTP|status|Status/.test(msg)
  );
}

/* ---------------- internal ---------------- */

/** Hash kecil untuk scope cache (cookie tidak boleh jadi key mentah:
 *  key cache bisa terlihat di log/debug). */
function hashScope(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
