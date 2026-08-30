/**
 * Hono app murni — semua endpoint & logic. Tidak tahu runtime-nya apa.
 * Dipakai oleh server/node.ts (VPS) dan server/worker.ts (Cloudflare).
 *
 * Pembagian kerja (keputusan arsitektur, hasil PoC):
 * - Data feed (search/home/next/library): raw InnerTube JSON via
 *   actions.execute + parser sendiri (src/parsers.ts) — imun terhadap
 *   churn node-class youtubei.js, pola terbukti dari Rich Music.
 * - /player: youtubei.js TrackInfo + decipher — butuh signature solver.
 */
import { Hono } from 'hono';

import type { CacheAdapter } from './cache.js';
import { createPlaybackInnertube, getDataInnertube, type InnertubeDeps } from './innertube.js';
import type { Innertube as InnertubeInstance } from 'youtubei.js/agnostic';
import { findAll, findFirst, parseListItem, parseSections, parseTwoRow, text, thumbs, type ParsedItem } from './parsers.js';

export interface AppDeps extends InnertubeDeps {
  cache: CacheAdapter;
}

/** Raw InnerTube call, unwrap .data dari HttpResponse. */
async function rawExecute(
  yt: InnertubeInstance,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await yt.session.actions.execute(endpoint, {
    client: 'YTMUSIC',
    ...payload,
  });
  const data = (res as { data?: Record<string, unknown> }).data ?? res;
  return data as Record<string, unknown>;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  /** IP client: di belakang CF → cf-connecting-ip; di VPS → x-forwarded-for.
   *  Dipakai untuk bind stream URL googlevideo ke IP client. */
  const clientIpOf = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined;

  /** Cookie akun dikirim app per-request (header x-yt-cookie). Server stateless. */
  const cookieOf = (c: { req: { header(name: string): string | undefined } }) => {
    const raw = c.req.header('x-yt-cookie');
    return raw && raw.length > 0 ? raw : undefined;
  };

  /** Cache key membedakan anonim vs per-cookie (algo akun tidak boleh tercampur). */
  const scopeOf = (cookie: string | undefined) =>
    cookie ? `u${cookie.length}:${hashStr(cookie)}` : 'anon';

  app.get('/healthz', (c) => c.json({ ok: true, ts: Date.now() }));

  app.get('/search', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json({ error: 'missing q' }, 400);
    const filter = c.req.query('filter'); // song | video | album | artist | playlist | undefined

    const cacheKey = `search:${scopeOf(cookieOf(c))}:${filter ?? 'all'}:${q}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const yt = await getDataInnertube(deps, cookieOf(c));
    const payload: Record<string, unknown> = { query: q };
    if (filter) {
      // params filter search YTM (base64 protobuf) — set yang umum dipakai
      const FILTER_PARAMS: Record<string, string> = {
        song: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
        video: 'EgWKAQIQAWoMEA4QChADEAQQCRAF',
        album: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
        artist: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
        playlist: 'EgeKAQQoAEABagoQAxAEEAkQBRAK',
      };
      payload.params = FILTER_PARAMS[filter];
    }

    const data = await rawExecute(yt, '/search', payload);
    const sections = parseSearchSections(data);
    const json = { sections };
    await deps.cache.set(cacheKey, json, 10 * 60_000);
    return c.json(json);
  });

  app.get('/home', async (c) => {
    const cookie = cookieOf(c);
    const cacheKey = `home:${scopeOf(cookie)}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const yt = await getDataInnertube(deps, cookie);
    const data = await rawExecute(yt, '/browse', { browseId: 'FEmusic_home' });
    const sl = findFirst<{ contents?: never[] }>(data, 'sectionListRenderer');
    const sections = parseSections(sl?.contents ?? []);
    const json = { sections };
    await deps.cache.set(cacheKey, json, 5 * 60_000);
    return c.json(json);
  });

  app.get('/library', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    const yt = await getDataInnertube(deps, cookie);
    const data = await rawExecute(yt, '/browse', {
      browseId: 'FEmusic_library_landing',
    });
    const sl = findFirst<{ contents?: never[] }>(data, 'sectionListRenderer');
    return c.json({ sections: parseSections(sl?.contents ?? []) });
  });

  app.get('/browse', async (c) => {
    const id = c.req.query('id')?.trim();
    if (!id) return c.json({ error: 'missing id' }, 400);
    const yt = await getDataInnertube(deps, cookieOf(c));
    const browseId = normalizeBrowseId(id);
    const data = await rawExecute(yt, '/browse', { browseId });
    const sl = findFirst<{ contents?: never[] }>(data, 'sectionListRenderer');
    const sections = parseSections(sl?.contents ?? []);

    // grid (halaman mood/genre & beberapa related) → section
    for (const g of findAll<{ items?: Record<string, never>[]; header?: unknown }>(
      data,
      'gridRenderer',
    )) {
      const items = (g.items ?? [])
        .map((it) => {
          const two = (it as { musicTwoRowItemRenderer?: never }).musicTwoRowItemRenderer;
          return two ? parseTwoRow(two) : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (items.length) {
        const header = findFirst<{ runs?: { text: string }[] }>(g.header, 'title');
        sections.push({ title: text(header), items });
      }
    }
    return c.json({ sections });
  });

  app.get('/next', async (c) => {
    const videoId = c.req.query('videoId')?.trim();
    if (!videoId) return c.json({ error: 'missing videoId' }, 400);
    const yt = await getDataInnertube(deps, cookieOf(c));
    const data = await rawExecute(yt, '/next', {
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true,
      tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
      watchEndpointMusicSupportedConfigs: {
        watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' },
      },
    });
    const queue = findAll<Record<string, never>>(data, 'playlistPanelVideoRenderer').map(
      (p) => parsePanelItem(p),
    );
    return c.json({ queue });
  });

  /** Stream URL untuk react-native-track-player (fetch langsung dari
   *  googlevideo oleh HP). CATATAN (PoC): X-Forwarded-For TIDAK mengubah
   *  binding `ip=` pada client WEB_REMIX — kalau HP kena 403, pakai /stream. */
  app.get('/player', async (c) => {
    const videoId = c.req.query('videoId')?.trim();
    if (!videoId) return c.json({ error: 'missing videoId' }, 400);

    const yt = await createPlaybackInnertube(deps, cookieOf(c), clientIpOf(c));
    const info = await yt.music.getInfo(videoId);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const url = await format.decipher(yt.session.player);

    return c.json({
      videoId,
      url,
      mimeType: format.mime_type,
      bitrate: format.bitrate,
      audioQuality: format.audio_quality,
      title: info.basic_info.title,
      artist: info.basic_info.author,
      durationMs: (info.basic_info.duration ?? 0) * 1000,
    });
  });

  /** Fallback playback: relay audio bytes lewat server (IP server = IP yang
   *  meminta URL, pasti cocok). Untuk VPS pribadi bandwidth-nya aman.
   *  Client: coba /player langsung dulu → 403 → ganti ke /stream. */
  app.get('/stream', async (c) => {
    const videoId = c.req.query('videoId')?.trim();
    if (!videoId) return c.json({ error: 'missing videoId' }, 400);

    const yt = await createPlaybackInnertube(deps, cookieOf(c), clientIpOf(c));
    const info = await yt.music.getInfo(videoId);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const url = await format.decipher(yt.session.player);

    // googlevideo tolak tanpa Range + browser UA (403). Selalu kirim Range
    // ke upstream; pakai Range client kalau ada, else fallback bytes=0-.
    const clientRange = c.req.header('range');
    const upstream = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Range: clientRange ?? 'bytes=0-',
      },
    });
    if (!upstream.ok || !upstream.body)
      return c.json({ error: `upstream ${upstream.status}` }, 502);

    const headers = new Headers();
    headers.set('content-type', format.mime_type ?? 'audio/mp4');
    headers.set('accept-ranges', 'bytes');

    if (clientRange) {
      // Client minta Range → forward 206 + content-range apa adanya.
      const len = upstream.headers.get('content-length');
      if (len) headers.set('content-length', len);
      const cr = upstream.headers.get('content-range');
      if (cr) headers.set('content-range', cr);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    // Client tanpa Range → normalize ke 200 OK. ExoPlayer probe awal
    // reject 206 tak diminta (stuck IDLE tanpa onPlayerError). Content-length
    // pakai total size dari upstream content-range ("bytes 0-N/TOTAL"), bukan
    // slice size. Body bisa lebih pendek dari total — client akan Range-request
    // sisanya. Kalau content-range tidak ada, drop content-length (chunked).
    const cr = upstream.headers.get('content-range');
    const totalMatch = cr?.match(/\/(\d+)\s*$/);
    if (totalMatch) headers.set('content-length', totalMatch[1]);
    return new Response(upstream.body, { status: 200, headers });
  });

  app.onError((err, c) => {
    console.error(`[sonora-proxy] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  });

  return app;
}

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/** Layout search modern: musicCardShelfRenderer (top) + flat
 *  itemSectionRenderer; layout lama: musicShelfRenderer per kategori. */
function parseSearchSections(data: Record<string, unknown>) {
  const tab = findFirst<{ content?: { sectionListRenderer?: { contents?: never[] } } }>(
    data,
    'tabRenderer',
  );
  const sl =
    tab?.content?.sectionListRenderer ??
    findFirst<{ contents?: never[] }>(data, 'sectionListRenderer');
  const raw = sl?.contents ?? [];
  const sections = parseSections(raw);
  if (!sections.length) {
    const flat: ParsedItem[] = [];
    const seen = new Set<string>();
    for (const sec of findAll<Record<string, never>>(data, 'itemSectionRenderer')) {
      for (const item of (sec as { contents?: Record<string, never>[] }).contents ?? []) {
        const renderer = (item as { musicResponsiveListItemRenderer?: never })
          .musicResponsiveListItemRenderer;
        if (!renderer) continue;
        const parsed = parseListItem(renderer);
        if (!parsed) continue;
        const key = parsed.videoId ?? parsed.browseId ?? parsed.title;
        if (!seen.has(key)) {
          seen.add(key);
          flat.push(parsed);
        }
      }
    }
    if (flat.length) sections.push({ title: 'Results', items: flat });
  }

  const top = findFirst<Record<string, never>>(data, 'musicCardShelfRenderer');
  if (top) {
    const parsedTop = parseCardShelf(top);
    if (parsedTop) sections.unshift(parsedTop);
  }
  return sections;
}

function parseCardShelf(top: Record<string, unknown>) {
  const titleRuns = top.title as { runs?: { text: string; navigationEndpoint?: never }[] } | undefined;
  const first = titleRuns?.runs?.[0];
  const nav = first?.navigationEndpoint as
    | { watchEndpoint?: { videoId: string }; browseEndpoint?: { browseId: string } }
    | undefined;
  const videoId = nav?.watchEndpoint?.videoId;
  const browseId = nav?.browseEndpoint?.browseId;
  let type = 'song';
  if (!videoId && browseId) {
    if (browseId.startsWith('MPRE')) type = 'album';
    else if (browseId.startsWith('UC')) type = 'artist';
    else type = 'playlist';
  }
  return {
    title: 'Top result',
    items: [
      {
        type,
        title: text(titleRuns),
        subtitle: text(top.subtitle as never),
        thumbnail: thumbs(top.thumbnail),
        videoId,
        browseId,
      },
    ],
  };
}

function parsePanelItem(p: Record<string, unknown>) {
  return {
    videoId: p.videoId as string,
    title: text(p.title as never),
    artist: text((p.shortBylineText ?? p.longBylineText) as never),
    duration: text(p.lengthText as never),
    thumbnail: thumbs(p.thumbnail),
    selected: !!p.selected,
  };
}

/** Playlist id perlu prefix VL untuk endpoint browse. */
function normalizeBrowseId(id: string): string {
  if (/^(PL|RDCLAK|OLAK)/.test(id) && !id.startsWith('VL')) return `VL${id}`;
  return id;
}

