/**
 * Innertube factory.
 *
 * Innertube class di-inject dari entrypoint (DI), BUKAN di-import di sini:
 * - server/node.ts   → import dari 'youtubei.js'        (platform build Node)
 * - server/worker.ts → import dari 'youtubei.js/cf-worker' (platform build Workers)
 * Ini satu-satunya perbedaan runtime antara dua target deploy.
 *
 * X-Forwarded-For: dikirim ke InnerTube atas nama IP client (pola yt-dlp).
 * CATATAN (hasil PoC 2026-08): WEB_REMIX mengabaikan XFF untuk binding
 * parameter `ip=` pada stream URL — binding tetap ke IP egress server.
 * Dampaknya: /player (URL untuk di-fetch HP langsung) berisiko 403 dari HP;
 * fallback /stream (relay bytes lewat server) pasti cocok IP-nya.
 *
 * Data feed & playback instance di-cache per (cookie, ip): membuat instance
 * = ±6 network call (session bootstrap), terlalu mahal per-request — apalagi
 * /stream yang dipanggil berulang saat seek/buffer.
 */
import type { Innertube as InnertubeType } from 'youtubei.js/agnostic';

export type InnertubeCtor = typeof InnertubeType;

export interface InnertubeDeps {
  Innertube: InnertubeCtor;
}

/**
 * Konteks session ala YouTube yang dipilih user (dikirim mobile):
 * - cookie         → Cookie InnerTube.
 * - onBehalfOfUser → Page ID channel/brand (on_behalf_of_user). Wajib saat
 *   akun punya beberapa channel: tanpa ini InnerTube selalu memakai channel
 *   default, jadi feed terasa "akun yang salah".
 * - visitorData    → visitor data web (visitor_data). Membuat konten
 *   konsisten dengan sesi web walau tidak login.
 * - accountIndex   → index akun bila cookie multi-akun (account_index).
 *
 * Kenapa object (bukan argumen terpisah): field konteks opsional bisa
 * bertambah lagi tanpa mengubah signature fungsi, dan cache key mudah
 * dibangun dari gabungan semua field.
 */
export interface SessionOpts {
  cookie?: string;
  onBehalfOfUser?: string;
  visitorData?: string;
  accountIndex?: number;
}

/** Cache instance per kunci. Module-level: di VPS bertahan selama proses;
 *  di Workers ikut lifecycle isolate (cold start). */
const instances = new Map<string, Promise<InnertubeType>>();

/** Key instance playback — hanya cookie + ip (XFF), konteks data tidak relevan
 *  untuk /player & /stream. */
const instanceKey = (cookie: string | undefined): string =>
  cookie ? `cookie:${hashStr(cookie)}` : 'anon';

/**
 * Key cache instance data-feed. HARUS mencakup SEMUA field SessionOpts:
 * dua konteks berbeda (mis. onBehalfOfUser channel A vs B) yang menumpuk di
 * satu instance akan saling menimpa respons feed-nya. Field kosong tetap
 * dipisahkan ('u-', 'v-', 'a-') supaya key tak ambigu — mis. hash kosong
 * tidak bisa tertukar dengan hash cookie.
 */
const sessionKey = (opts: SessionOpts): string =>
  [
    opts.cookie ? `c${hashStr(opts.cookie)}` : 'anon',
    opts.onBehalfOfUser ? `u${hashStr(opts.onBehalfOfUser)}` : 'u-',
    opts.visitorData ? `v${hashStr(opts.visitorData)}` : 'v-',
    opts.accountIndex !== undefined ? `a${opts.accountIndex}` : 'a-',
  ].join(':');

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Instance data-feed (search/home/next/library). Di-cache. Tanpa XFF.
 *
 * Dua bentuk argumen demi kompatibilitas:
 * - (deps, cookie?)              → perilaku lama, pemanggil lama tetap compile.
 * - (deps, SessionOpts)          → konteks penuh (onBehalfOfUser, dst).
 */
export function getDataInnertube(
  deps: InnertubeDeps,
  cookie?: string,
): Promise<InnertubeType>;
export function getDataInnertube(
  deps: InnertubeDeps,
  opts: SessionOpts,
): Promise<InnertubeType>;
export function getDataInnertube(
  deps: InnertubeDeps,
  cookieOrOpts?: string | SessionOpts,
): Promise<InnertubeType> {
  const opts: SessionOpts =
    typeof cookieOrOpts === 'object' && cookieOrOpts !== null
      ? cookieOrOpts
      : { cookie: cookieOrOpts };
  const key = sessionKey(opts);
  let inst = instances.get(key);
  if (!inst) {
    inst = deps.Innertube.create({
      cookie: opts.cookie || undefined,
      on_behalf_of_user: opts.onBehalfOfUser || undefined,
      visitor_data: opts.visitorData || undefined,
      account_index: opts.accountIndex,
    });
    instances.set(key, inst);
    // Gagal create (mis. network) → jangan cache promise gagal
    inst.catch(() => instances.delete(key));
  }
  return inst;
}

/**
 * Hapus instance data-feed dari cache (key dibangun dari opts yang sama
 * dengan getDataInnertube). Dipakai untuk retry setelah 401/403: tanpa
 * invalidation, request berikutnya memakai kembali instance bermasalah.
 * Idempotent — key yang tidak ada di cache diabaikan.
 *
 * deps ikut di signature demi simetri API dengan getDataInnertube
 * (pemanggil sudah punya objek deps di tangan); tidak dipakai saat ini.
 */
export function invalidateDataInnertube(
  deps: InnertubeDeps,
  opts: SessionOpts,
): void {
  void deps;
  instances.delete(sessionKey(opts));
}

/** Instance playback untuk /player & /stream: fetch meng-inject XFF client.
 * Di-cache per (cookie, ip) — pembuatan instance mahal (±6 network call). */
export function createPlaybackInnertube(
  deps: InnertubeDeps,
  cookie: string | undefined,
  clientIp: string | undefined,
): Promise<InnertubeType> {
  const key = `play:${instanceKey(cookie)}:${clientIp ?? 'direct'}`;
  let inst = instances.get(key);
  if (!inst) {
    const forwardIp = clientIp?.trim() || undefined;
    const fetchWithXff: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      if (forwardIp) headers.set('X-Forwarded-For', forwardIp);
      return fetch(input, { ...init, headers });
    };
    inst = deps.Innertube.create({
      cookie: cookie || undefined,
      fetch: fetchWithXff,
    });
    instances.set(key, inst);
    inst.catch(() => instances.delete(key));
  }
  return inst;
}
