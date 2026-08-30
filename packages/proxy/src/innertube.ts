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

/** Cache instance per kunci (cookie hash atau 'anon'). Module-level: di VPS
 *  bertahan selama proses; di Workers ikut lifecycle isolate (cold start). */
const instances = new Map<string, Promise<InnertubeType>>();

const instanceKey = (cookie: string | undefined): string =>
  cookie ? `cookie:${hashStr(cookie)}` : 'anon';

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/** Instance data-feed (search/home/next/library). Di-cache. Tanpa XFF. */
export function getDataInnertube(
  deps: InnertubeDeps,
  cookie?: string,
): Promise<InnertubeType> {
  const key = instanceKey(cookie);
  let inst = instances.get(key);
  if (!inst) {
    inst = deps.Innertube.create({ cookie: cookie || undefined });
    instances.set(key, inst);
    // Gagal create (mis. network) → jangan cache promise gagal
    inst.catch(() => instances.delete(key));
  }
  return inst;
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
