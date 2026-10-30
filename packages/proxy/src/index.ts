/**
 * Hono app murni — semua endpoint & logic. Tidak tahu runtime-nya apa.
 * Dipakai oleh server/node.ts (VPS) dan server/worker.ts (Cloudflare).
 *
 * Pembagian kerja (keputusan arsitektur, hasil PoC):
 * - Data feed (search/home/browse/next/library): raw InnerTube JSON via
 *   actions.execute + parser sendiri (src/parsers.ts) — imun terhadap
 *   churn node-class youtubei.js, pola terbukti dari Rich Music.
 * - /player: youtubei.js TrackInfo + decipher — butuh signature solver.
 *
 * Sesi data-feed: semua endpoint data-feed memakai pola withDataSession —
 * konteks sesi dibangun dari header mobile (cookie/onBehalfOfUser/
 * visitorData/accountIndex) via sessionOptsOf/dataSessionOf, dan error auth
 * (401/403) memicu bootstrap ulang instance SEKALI sebelum gagal. Tujuannya
 * agar cookie yang dirotasi YouTube atau visitorData kadaluarsa tidak
 * menggagalkan satu request — session baru dibuat transparan.
 */
import { Hono, type Context } from 'hono';

import type { CacheAdapter } from './cache.js';
import {
  createPlaybackInnertube,
  getDataInnertube,
  invalidateDataInnertube,
  type InnertubeDeps,
  type SessionOpts,
} from './innertube.js';
import {
  fetchExactLrclibLyrics,
  normalizeLrclibSignature,
  parseDurationSeconds,
  type LrclibLookupResult,
} from './lrclib.js';
import type { Innertube as InnertubeInstance } from 'youtubei.js/agnostic';
import {
  extractContinuation,
  findAll,
  findFirst,
  normalizeDuration,
  parseArtistPageShelves,
  parseBrowseSections,
  parseEntityHeader,
  parseListItem,
  parseLyricsBrowseId,
  parseLyricsResponse,
  parseNextResponse,
  parseSections,
  parseTwoRow,
  text,
  thumbs,
  type ParsedItem,
  type ParsedSection,
} from './parsers.js';
import {
  canonicalPlaylistId,
  normalizePlaylistTitle,
  parsePlaylistLibraryState,
} from './playlists.js';
import {
  isAuthError,
  parseAccountChannels,
  parseAccountProfile,
  resolveVisitorData,
} from './session.js';
import { upstreamRangeFor } from './stream-range.js';

export interface AppDeps extends InnertubeDeps {
  cache: CacheAdapter;
  fetch: typeof globalThis.fetch;
  poToken?: import('./po-token.js').PoTokenProvider;
}

type CacheableLrclibResult = Extract<LrclibLookupResult, { kind: 'found' | 'not-found' }>;

interface CachedLrclibResult {
  signatureKey: string;
  result: CacheableLrclibResult;
}

const LRCLIB_FOUND_TTL_MS = 24 * 60 * 60_000;
const LRCLIB_NOT_FOUND_TTL_MS = 15 * 60_000;
const LRCLIB_COOLDOWN_KEY = 'lyrics:lrclib:cooldown';

/** VideoId InnerTube selalu 11 karakter [A-Za-z0-9_-]; dipakai gerbang input
 *  mutasi playlist supaya payload kotor tidak sampai ke upstream. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Batas aman ukuran batch edit_playlist: payload terlalu besar ditolak
 *  upstream, jadi reorder dikirim per kelipatan ini. */
const PLAYLIST_MOVE_BATCH = 50;

interface PagedItems {
  items: ParsedItem[];
  /** Token lanjutan bila kuota halaman habis tapi upstream masih punya data. */
  continuation?: string;
}

interface PlaylistMove {
  setVideoId: string;
  /** Item yang harus berada tepat SETELAH lagu yang dipindah (opsional —
   *  memindah ke akhir daftar tidak butuh successor). */
  successorSetVideoId?: string;
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

interface MutationResponse {
  success: boolean;
  statusCode: number;
  data: Record<string, unknown>;
}

async function executeMutation(
  yt: InnertubeInstance,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<MutationResponse> {
  const response = await yt.session.actions.execute(endpoint, {
    client: 'YTMUSIC',
    parse: false,
    ...payload,
  });
  const raw = response as {
    success?: unknown;
    status_code?: unknown;
    data?: unknown;
  };
  return {
    success: raw.success === true,
    statusCode: typeof raw.status_code === 'number' ? raw.status_code : 0,
    data:
      raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
        ? (raw.data as Record<string, unknown>)
        : {},
  };
}

/* ---------------- helper data-feed (module-level, murni) ---------------- */

/** Kumpulkan semua lagu (type 'song' + punya videoId) dari gabungan sections.
 *  Item non-lagu (album/artis/video) disisakan ke pemanggil lain lewat sections.
 *  Dipakai history/recents/library/album/artist. */
function flattenSongItems(
  sections: ReadonlyArray<{ items?: readonly ParsedItem[] }>,
): ParsedItem[] {
  const songs: ParsedItem[] = [];
  for (const section of sections) {
    for (const item of section.items ?? []) {
      if (item.type === 'song' && item.videoId) songs.push(item);
    }
  }
  return songs;
}

/** Pertahankan kemunculan PERTAMA tiap videoId — feed history/library tersusun
 *  terbaru-dulu, jadi entri pertama adalah yang paling relevan. Item tanpa
 *  videoId lolos apa adanya (tidak punya identitas untuk dibandingkan). */
function dedupeByVideoId(items: ParsedItem[]): ParsedItem[] {
  const seen = new Set<string>();
  const out: ParsedItem[] = [];
  for (const item of items) {
    if (!item.videoId) {
      out.push(item);
      continue;
    }
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    out.push(item);
  }
  return out;
}

/** Dedupe item ANTAR-section dengan satu set `seen` bersama (keep-first,
 *  urutan dokumen): history menaruh lagu yang sama di shelf hari berbeda dan
 *  hanya kemunculan terbaru yang perlu tampil. Section yang kosong setelah
 *  dedupe dibuang supaya tidak ada header tanpa isi. */
function dedupeSectionsInPlace(sections: ParsedSection[]): ParsedSection[] {
  const seen = new Set<string>();
  const kept: ParsedSection[] = [];
  for (const section of sections) {
    section.items = section.items.filter((item) => {
      if (!item.videoId) return true;
      if (seen.has(item.videoId)) return false;
      seen.add(item.videoId);
      return true;
    });
    if (section.items.length) kept.push(section);
  }
  return kept;
}

/**
 * Parse halaman lanjutan respons /browse. Continuation TIDAK memakai
 * sectionListRenderer — kontennya datang sebagai `musicShelfContinuation`
 * (bentuk internal identik musicShelfRenderer, jadi di-re-key agar bisa lewat
 * parseSections — satu sumber kebenaran parsing item), atau dibungkus
 * `sectionListContinuation` untuk feed tertentu.
 */
function parseContinuationSections(data: unknown): ParsedSection[] {
  const shelves = findAll<Record<string, unknown>>(data, 'musicShelfContinuation');
  if (shelves.length) {
    return parseSections(
      shelves.map((shelf) => ({ musicShelfRenderer: shelf })) as never,
    );
  }
  const lists = findAll<{ contents?: never[] }>(data, 'sectionListContinuation');
  return lists.flatMap((list) => parseSections(list.contents ?? []));
}

/**
 * Browse satu browseId lalu ikuti token continuation hingga habis atau
 * `maxPages` halaman (halaman pertama termasuk hitungan). Menggabungkan
 * parseBrowseSections (halaman awal) dan parseContinuationSections (halaman
 * lanjutan) karena bentuk respons keduanya berbeda — merge di sini membuat
 * pemanggil tidak perlu tahu bedanya.
 */
async function browsePagedItems(
  yt: InnertubeInstance,
  browseId: string,
  opts?: { params?: string; maxPages?: number },
): Promise<PagedItems> {
  const maxPages = opts?.maxPages ?? 5;
  const items: ParsedItem[] = [];
  let continuation: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const payload: Record<string, unknown> = continuation
      ? { continuation }
      : { browseId, ...(opts?.params ? { params: opts.params } : {}) };
    const data = await rawExecute(yt, '/browse', payload);
    items.push(
      ...parseBrowseSections(data).flatMap((section) => section.items),
      ...parseContinuationSections(data).flatMap((section) => section.items),
    );
    continuation = extractContinuation(data);
    if (!continuation) return { items };
  }
  // Kuota halaman habis tapi token masih ada → dikembalikan ke caller
  // (mobile bisa lanjut via endpoint /continue masing-masing).
  return { items, continuation };
}

/** Sama dengan browsePagedItems tapi hanya menyisakan lagu. */
async function pagedBrowseSongs(
  yt: InnertubeInstance,
  browseId: string,
  maxPages = 5,
): Promise<PagedItems> {
  const { items, continuation } = await browsePagedItems(yt, browseId, { maxPages });
  const songs = flattenSongItems([{ items }]);
  return continuation ? { items: songs, continuation } : { items: songs };
}

/**
 * Diff reorder ala edit_playlist: bandingkan urutan current vs target, dan
 * untuk tiap posisi yang tidak cocok pindahkan item target ke posisi itu
 * (splice dari posisi lama, sisip di posisi baru). Return null kalau ada item
 * target yang tidak ada di current — sisa list tidak bisa direkonstruksi dari
 * state itu, caller yang membalas 400.
 */
function playlistMoves(current: string[], target: string[]): PlaylistMove[] | null {
  const cur = [...current];
  const moves: PlaylistMove[] = [];
  for (let i = 0; i < target.length; i++) {
    if (cur[i] === target[i]) continue;
    const from = cur.indexOf(target[i], i);
    if (from === -1) return null;
    cur.splice(from, 1);
    cur.splice(i, 0, target[i]);
    moves.push({
      setVideoId: target[i],
      ...(target[i + 1] ? { successorSetVideoId: target[i + 1] } : {}),
    });
  }
  return moves;
}

/**
 * Ambil array string dari body JSON; null kalau field bukan array atau ada
 * entry yang bukan string non-kosong. Mutasi upstream bersifat all-or-nothing
 * per request — body sebagian-valid lebih baik ditolak di gerbang daripada
 * dieksekusi sebagian lalu state client ambigu.
 */
function stringArrayOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) return null;
    out.push(entry);
  }
  return out;
}

/** Browse ID feed library per koleksi. `liked` memakai VLLM (playlist
 *  "Liked Music") karena landing library tidak mengekspos daftar lagunya. */
const LIBRARY_FEEDS: ReadonlyArray<readonly [string, string]> = [
  ['liked', 'VLLM'],
  ['songs', 'FEmusic_liked_videos'],
  ['albums', 'FEmusic_liked_albums'],
  ['artists', 'FEmusic_library_corpus_track_artists'],
  ['subscriptions', 'FEmusic_library_corpus_artists'],
  ['playlists', 'FEmusic_liked_playlists'],
];

/**
 * Single-flight in-process untuk /library/recents, key = cache key scope.
 * Halaman recents selalu dipanggil saat cold start app; tanpa single-flight,
 * beberapa request paralel untuk scope sama menembak InnerTube bersamaan
 * (thundering herd). Entry dihapus di finally supaya map tidak tumbuh; promise
 * gagal tidak di-cache — request berikutnya mencoba lagi.
 */
const recentsInflight = new Map<string, Promise<{ items: ParsedItem[] }>>();

/** Bentuk minimum request yang dipakai helper sesi/cache — longgar sengaja
 *  supaya bisa dipakai dari Context Hono maupun mock test. */
type HeaderSource = { req: { header(name: string): string | undefined } };

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  /** IP client: di belakang CF → cf-connecting-ip; di VPS → x-forwarded-for.
   *  Dipakai untuk bind stream URL googlevideo ke IP client. */
  const clientIpOf = (c: HeaderSource) =>
    c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined;

  /** Cookie akun dikirim app per-request (header x-yt-cookie). Server stateless. */
  const cookieOf = (c: HeaderSource) => {
    const raw = c.req.header('x-yt-cookie');
    return raw && raw.length > 0 ? raw : undefined;
  };

  /** Cache key membedakan anonim vs per-cookie (algo akun tidak boleh tercampur). */
  const scopeOf = (cookie: string | undefined) =>
    cookie ? `u${cookie.length}:${hashStr(cookie)}` : 'anon';

  /**
   * SessionOpts dari header request: cookie (x-yt-cookie), onBehalfOfUser
   * (x-yt-user — Page ID channel untuk akun multi-channel), visitorData
   * (x-yt-visitor), accountIndex (x-yt-account-index).
   */
  const sessionOptsOf = (c: HeaderSource): SessionOpts => {
    const opts: SessionOpts = { cookie: cookieOf(c) };
    const user = c.req.header('x-yt-user');
    if (user) opts.onBehalfOfUser = user;
    const visitor = c.req.header('x-yt-visitor');
    if (visitor) opts.visitorData = visitor;
    const accountIndexRaw = c.req.header('x-yt-account-index');
    if (accountIndexRaw) {
      const parsed = Number.parseInt(accountIndexRaw, 10);
      if (Number.isInteger(parsed) && parsed >= 0) opts.accountIndex = parsed;
    }
    return opts;
  };

  /** Cookie sesi web asli selalu berupa pasangan name=value (SID=..., dst).
   *  String tanpa '=' tidak bisa menjadi sesi web yang sah — resolve
   *  visitorData untuk itu pasti sia-sia, jadi lewati (sekaligus menjaga
   *  fixture test yang memakai cookie dummy tetap tidak menembak jaringan). */
  const isWebCookie = (cookie: string) => cookie.includes('=');

  /**
   * sessionOptsOf + resolve visitorData server-side kalau mobile tidak
   * mengirim x-yt-visitor sendiri (sw.js_data, di-cache 6 jam oleh session.ts;
   * kegagalannya di-cache 10 menit). visitorData membuat feed konsisten dengan
   * sesi web — penting untuk history/library yang sensitif konteks.
   */
  const dataSessionOf = async (c: HeaderSource): Promise<SessionOpts> => {
    const opts = sessionOptsOf(c);
    if (opts.cookie && !opts.visitorData && isWebCookie(opts.cookie)) {
      opts.visitorData = await resolveVisitorData(deps, opts.cookie);
    }
    return opts;
  };

  /**
   * Jalankan fn dengan instance data-feed yang sesuai konteks sesi. Error auth
   * (401/403) dianggap konteks sesi basi (cookie dirotasi YouTube / visitor
   * kadaluarsa): buang instance yang bermasalah → bootstrap ulang → coba
   * SEKALI. Tidak ada loop — kalau retry juga gagal, error dilempar apa adanya.
   */
  const withDataSession = async <T>(
    opts: SessionOpts,
    fn: (yt: InnertubeInstance) => Promise<T>,
  ): Promise<T> => {
    let yt = await getDataInnertube(deps, opts);
    try {
      return await fn(yt);
    } catch (err) {
      if (!isAuthError(err)) throw err;
      invalidateDataInnertube(deps, opts);
      yt = await getDataInnertube(deps, opts);
      return await fn(yt);
    }
  };

  /** Body JSON object dari request; undefined kalau body bukan JSON object
   *  (body rusak diperlakukan "tidak ada", bukan error 500). */
  const jsonBodyOf = async (c: Context): Promise<Record<string, unknown> | undefined> => {
    const body: unknown = await c.req.json<unknown>().catch(() => undefined);
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  };

  app.get('/healthz', (c) => c.json({ ok: true, ts: Date.now() }));

  /* ---------------- auth/session ---------------- */

  /** GET+POST /auth/session — verifikasi cookie & daftar channel akun.
   *  POST disediakan supaya mobile bisa memakai satu bentuk call untuk
   *  "cek sesi" yang secara semantik bukan read-only murni (refresh token
   *  visitor di sisi server). */
  const authSessionHandler = async (c: Context) => {
    const cookie = cookieOf(c);
    if (!cookie) {
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    }

    const cacheKey = `session:${scopeOf(cookie)}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const json = await withDataSession(await dataSessionOf(c), async (yt) => {
      const menuData = await rawExecute(yt, '/account/account_menu', {});
      const profile = parseAccountProfile(menuData);
      // Tanpa profil = cookie tidak membawa sesi valid → 401. Sengaja TIDAK
      // di-cache supaya user bisa langsung retry setelah login ulang.
      if (!profile) return undefined;

      // Envelope accounts_list gagal/kosong = bentuk tak dikenal, BUKAN jawaban
      // "tidak ada channel" — fallback ke channel yang ikut di account_menu
      // (keduanya memuat accountItemRenderer, ala BitChord).
      const accountsData = await rawExecute(yt, '/account/accounts_list', {}).catch(
        () => null,
      );
      const channels = parseAccountChannels(accountsData);
      return {
        profile,
        channels: channels.length ? channels : parseAccountChannels(menuData),
        valid: true,
      };
    });
    if (!json) return c.json({ error: 'invalid session' }, 401);

    await deps.cache.set(cacheKey, json, 60_000);
    return c.json(json);
  };
  app.get('/auth/session', authSessionHandler);
  app.post('/auth/session', authSessionHandler);

  /* ---------------- search / home ---------------- */

  app.get('/search', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json({ error: 'missing q' }, 400);
    const filter = c.req.query('filter'); // song | video | album | artist | playlist | undefined

    const cacheKey = `search:${scopeOf(cookieOf(c))}:${filter ?? 'all'}:${q}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const json = await withDataSession(await dataSessionOf(c), async (yt) => {
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
      return { sections: parseSearchSections(data) };
    });

    await deps.cache.set(cacheKey, json, 10 * 60_000);
    return c.json(json);
  });

  app.get('/home', async (c) => {
    const cookie = cookieOf(c);
    const cacheKey = `home:${scopeOf(cookie)}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const json = await withDataSession(await dataSessionOf(c), async (yt) => {
      const data = await rawExecute(yt, '/browse', { browseId: 'FEmusic_home' });
      return { sections: parseBrowseSections(data) };
    });

    await deps.cache.set(cacheKey, json, 5 * 60_000);
    return c.json(json);
  });

  /* ---------------- playlists ---------------- */

  app.post('/playlists', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie) {
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    }

    const body = await c.req.json<unknown>().catch(() => undefined);
    const title = normalizePlaylistTitle(
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).title
        : undefined,
    );
    if (!title) return c.json({ error: 'invalid title' }, 400);

    const yt = await getDataInnertube(deps, cookie);
    const result = await executeMutation(yt, 'playlist/create', {
      title,
      privacyStatus: 'PRIVATE',
      videoIds: [],
    });
    const playlistId = canonicalPlaylistId(result.data.playlistId);
    if (!result.success || !playlistId) {
      return c.json(
        { error: 'playlist creation failed', upstreamStatus: result.statusCode },
        502,
      );
    }
    return c.json({ playlistId }, 201);
  });

  /** Tambah lagu ke playlist. Mobile mengirim videoIds yang sudah dipilih user;
   *  respons membawa setVideoId per baris agar operasi lanjutan (hapus/reorder)
   *  tidak perlu browse ulang hanya untuk mendapat id baris. */
  app.post('/playlists/:playlistId/items', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie) {
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    }
    const playlistId = canonicalPlaylistId(c.req.param('playlistId'));
    if (!playlistId) return c.json({ error: 'invalid playlistId' }, 400);

    const body = await jsonBodyOf(c);
    const videoIds = stringArrayOf(body?.videoIds);
    // VideoId wajib kanonik 11-char: upstream menolak bentuk lain dengan error
    // yang sulit dipetakan — validasi di gerbang lebih murah dan jelas.
    if (!videoIds?.length || videoIds.some((videoId) => !VIDEO_ID_RE.test(videoId))) {
      return c.json({ error: 'invalid videoIds' }, 400);
    }

    const result = await withDataSession(await dataSessionOf(c), (yt) =>
      executeMutation(yt, 'browse/edit_playlist', {
        playlistId: `VL${playlistId}`,
        actions: videoIds.map((videoId) => ({
          action: 'ACTION_ADD_VIDEO',
          addedVideoId: videoId,
        })),
      }),
    );
    if (!result.success) {
      return c.json(
        { error: 'playlist items add failed', upstreamStatus: result.statusCode },
        502,
      );
    }

    // Satu node hasil per lagu ditambahkan; id baris bisa hidup langsung di
    // node atau di dalam playlistItemData tergantung bentuk respons — cek dua
    //-duanya agar identitas baris tidak hilang.
    const results = findAll<Record<string, unknown>>(
      result.data,
      'playlistEditVideoAddedResultData',
    ).map((node) => {
      const item = (node.playlistItemData ?? node) as Record<string, unknown>;
      const videoId =
        typeof item.videoId === 'string' && item.videoId ? item.videoId : undefined;
      const setVideoId =
        typeof item.setVideoId === 'string' && item.setVideoId
          ? item.setVideoId
          : undefined;
      return {
        ...(videoId ? { videoId } : {}),
        ...(setVideoId ? { setVideoId } : {}),
      };
    });
    return c.json({ results }, 201);
  });

  /** Hapus lagu dari playlist via setVideoId (id baris, bukan videoId). */
  app.delete('/playlists/:playlistId/items', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie) {
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    }
    const playlistId = canonicalPlaylistId(c.req.param('playlistId'));
    if (!playlistId) return c.json({ error: 'invalid playlistId' }, 400);

    const body = await jsonBodyOf(c);
    const setVideoIds = stringArrayOf(body?.setVideoIds);
    if (!setVideoIds?.length) return c.json({ error: 'invalid setVideoIds' }, 400);

    const result = await withDataSession(await dataSessionOf(c), (yt) =>
      executeMutation(yt, 'browse/edit_playlist', {
        playlistId: `VL${playlistId}`,
        actions: setVideoIds.map((setVideoId) => ({
          action: 'ACTION_REMOVE_VIDEO',
          setVideoId,
        })),
      }),
    );
    if (!result.success) {
      return c.json(
        { error: 'playlist items remove failed', upstreamStatus: result.statusCode },
        502,
      );
    }
    return c.json({ ok: true });
  });

  /** Rename dan/atau reorder playlist. Reorder dikirim sebagai diff
   *  (playlistMoves) per batch 50 — move action memakai posisi absolut
   *  (setVideoId + successor), jadi aman terhadap apply parsial antar batch. */
  app.patch('/playlists/:playlistId', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie) {
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    }
    const playlistId = canonicalPlaylistId(c.req.param('playlistId'));
    if (!playlistId) return c.json({ error: 'invalid playlistId' }, 400);

    const body = await jsonBodyOf(c);
    const title = body ? normalizePlaylistTitle(body.title) : null;
    const current = body ? stringArrayOf(body.current) : null;
    const target = body ? stringArrayOf(body.target) : null;
    // Reorder hanya diproses bila KEDUA list valid non-kosong: satu list saja
    // tidak cukup untuk menghitung diff yang berarti.
    let moves: PlaylistMove[] | null = null;
    if (current?.length && target?.length) {
      moves = playlistMoves(current, target);
      if (moves === null) {
        return c.json({ error: 'target order contains unknown items' }, 400);
      }
    }
    if (!title && !moves) return c.json({ error: 'nothing to update' }, 400);

    // null = semua batch sukses; selain itu = response batch pertama yang gagal
    // (dipakai untuk upstreamStatus). Retry sesi oleh withDataSession aman di
    // sini karena rename dan move keduanya posisi/nilai absolut (idempotent).
    const failed: MutationResponse | null = await withDataSession(
      await dataSessionOf(c),
      async (yt) => {
        if (title) {
          const rename = await executeMutation(yt, 'browse/edit_playlist', {
            playlistId: `VL${playlistId}`,
            actions: [{ action: 'ACTION_RENAME_PLAYLIST', playlistTitle: title }],
          });
          if (!rename.success) return rename;
        }
        if (moves) {
          for (let i = 0; i < moves.length; i += PLAYLIST_MOVE_BATCH) {
            const batch = moves
              .slice(i, i + PLAYLIST_MOVE_BATCH)
              .map((move) => ({
                action: 'ACTION_MOVE_VIDEO',
                setVideoId: move.setVideoId,
                ...(move.successorSetVideoId
                  ? { successorSetVideoId: move.successorSetVideoId }
                  : {}),
              }));
            const moveResult = await executeMutation(yt, 'browse/edit_playlist', {
              playlistId: `VL${playlistId}`,
              actions: batch,
            });
            if (!moveResult.success) return moveResult;
          }
        }
        return null;
      },
    );

    if (failed) {
      return c.json(
        { error: 'playlist update failed', upstreamStatus: failed.statusCode },
        502,
      );
    }
    return c.json({ ok: true });
  });

  /** Hapus playlist milik akun. Upstream memakai bentuk VL-prefixed. */
  app.delete('/playlists/:playlistId', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie) {
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    }
    const playlistId = canonicalPlaylistId(c.req.param('playlistId'));
    if (!playlistId) return c.json({ error: 'invalid playlistId' }, 400);

    const result = await withDataSession(await dataSessionOf(c), (yt) =>
      executeMutation(yt, 'playlist/delete', { playlistId: `VL${playlistId}` }),
    );
    if (!result.success) {
      return c.json(
        { error: 'playlist delete failed', upstreamStatus: result.statusCode },
        502,
      );
    }
    return c.json({ ok: true });
  });

  const mutatePlaylistLibrary = async (c: Context, saved: boolean) => {
    const cookie = cookieOf(c);
    if (!cookie) {
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    }
    const playlistId = canonicalPlaylistId(c.req.param('playlistId'));
    if (!playlistId) return c.json({ error: 'invalid playlistId' }, 400);

    const yt = await getDataInnertube(deps, cookie);
    const result = await executeMutation(
      yt,
      saved ? 'like/like' : 'like/removelike',
      { target: playlistId },
    );
    if (!result.success) {
      return c.json(
        { error: 'playlist library mutation failed', upstreamStatus: result.statusCode },
        502,
      );
    }
    return c.json({ playlistId, saved });
  };

  app.put('/library/playlists/:playlistId', (c) => mutatePlaylistLibrary(c, true));
  app.delete('/library/playlists/:playlistId', (c) => mutatePlaylistLibrary(c, false));

  /* ---------------- library ---------------- */

  /** Rebuild /library: tiap koleksi diambil dari feed browse-nya sendiri
   *  (paralel, retry sesi per feed) alih-alih landing page yang layout-nya
   *  sering berubah dan tidak mengekspos seluruh koleksi. */
  app.get('/library', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);

    const cacheKey = `library:${scopeOf(cookie)}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const opts = await dataSessionOf(c);
    const settled = await Promise.allSettled(
      LIBRARY_FEEDS.map(async ([name, browseId]) => {
        const data = await withDataSession(opts, (yt) =>
          rawExecute(yt, '/browse', { browseId }),
        );
        // SEMUA item (bukan hanya lagu) — mobile yang menyaring tipe per
        // koleksi (albums butuh album, artists butuh artis, dst).
        const items = parseBrowseSections(data).flatMap((section) => section.items);
        const continuation = extractContinuation(data);
        const feed = items.length
          ? { items, ...(continuation ? { continuation } : {}) }
          : undefined;
        return [name, feed] as const;
      }),
    );

    const collections: Record<string, unknown> = {};
    for (const entry of settled) {
      if (entry.status !== 'fulfilled') continue; // feed gagal → drop senyap
      const [name, feed] = entry.value;
      if (feed) collections[name] = feed;
    }
    const json = { collections };

    // Cache hanya jawaban LENGKAP (semua feed selesai tanpa error): jawaban
    // parsial jangan di-pin 2 menit — refresh berikutnya harus bisa melengkapi.
    if (settled.every((entry) => entry.status === 'fulfilled')) {
      await deps.cache.set(cacheKey, json, 2 * 60_000);
    }
    return c.json(json);
  });

  /** 20 lagu terakhir diputar — dipanggil saat cold start app, makanya
   *  diberi cache pendek + single-flight. */
  app.get('/library/recents', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);

    const cacheKey = `recents:${scopeOf(cookie)}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    let inflight = recentsInflight.get(cacheKey);
    if (!inflight) {
      const task = (async () =>
        withDataSession(await dataSessionOf(c), async (yt) => {
          const data = await rawExecute(yt, '/browse', { browseId: 'FEmusic_history' });
          return {
            items: dedupeByVideoId(flattenSongItems(parseBrowseSections(data))).slice(
              0,
              20,
            ),
          };
        }))();
      inflight = task;
      recentsInflight.set(cacheKey, inflight);
      // Derived promise dari finally tidak ditunggu siapa pun → tangkap
      // rejection-nya agar tidak jadi unhandled rejection (task aslinya
      // ditangani oleh `await inflight` pemanggil di bawah).
      task.finally(() => recentsInflight.delete(cacheKey)).catch(() => {});
    }

    const json = await inflight;
    await deps.cache.set(cacheKey, json, 2 * 60_000);
    return c.json(json);
  });

  /** Semua lagu liked (playlist VLLM) dengan paging penuh sampai 5 halaman
   *  (±500 lagu) — halaman library songs mobile menampilkan seluruh daftar. */
  app.get('/library/songs', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);

    const cacheKey = `libsongs:${scopeOf(cookie)}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const json = await withDataSession(await dataSessionOf(c), (yt) =>
      pagedBrowseSongs(yt, 'VLLM', 5),
    );
    await deps.cache.set(cacheKey, json, 5 * 60_000);
    return c.json(json);
  });

  /** Halaman lanjutan library songs — tanpa cache: token continuation
   *  cepat basi dan setiap halaman hanya dipakai sekali. */
  app.get('/library/songs/continue', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    const token = c.req.query('token')?.trim();
    if (!token) return c.json({ error: 'missing token' }, 400);

    const json = await withDataSession(await dataSessionOf(c), async (yt) => {
      const data = await rawExecute(yt, '/browse', { continuation: token });
      const continuation = extractContinuation(data);
      return {
        items: flattenSongItems(parseContinuationSections(data)),
        ...(continuation ? { continuation } : {}),
      };
    });
    return c.json(json);
  });

  /* ---------------- history ---------------- */

  app.get('/history', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);

    const cacheKey = `history:${scopeOf(cookie)}`;
    const cached = await deps.cache.get<unknown>(cacheKey);
    if (cached) return c.json(cached);

    const json = await withDataSession(await dataSessionOf(c), async (yt) => {
      const data = await rawExecute(yt, '/browse', { browseId: 'FEmusic_history' });
      const sl = findFirst<{ contents?: never[] }>(data, 'sectionListRenderer');
      const sections = dedupeSectionsInPlace(parseSections(sl?.contents ?? []));
      const continuation = extractContinuation(data);
      return { sections, ...(continuation ? { continuation } : {}) };
    });

    await deps.cache.set(cacheKey, json, 60_000);
    return c.json(json);
  });

  /** Halaman lanjutan history — bentuk sama dengan /history, tanpa cache. */
  app.get('/history/continue', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    const token = c.req.query('token')?.trim();
    if (!token) return c.json({ error: 'missing token' }, 400);

    const json = await withDataSession(await dataSessionOf(c), async (yt) => {
      const data = await rawExecute(yt, '/browse', { continuation: token });
      // Dedupe dalam halaman; continuation berikutnya tetap diekspos bila ada.
      const sections = dedupeSectionsInPlace(parseContinuationSections(data));
      const continuation = extractContinuation(data);
      return { sections, ...(continuation ? { continuation } : {}) };
    });
    return c.json(json);
  });

  /** Hapus satu item history via feedbackToken (dari item di /history).
   *  Setelah sukses, cache yang memuat item tsb dibuang agar UI tidak
   *  menampilkan lagu yang sudah dihapus sampai TTL habis. */
  app.delete('/history', async (c) => {
    const cookie = cookieOf(c);
    if (!cookie)
      return c.json({ error: 'login required (send x-yt-cookie header)' }, 401);
    const token = c.req.query('token')?.trim();
    if (!token) return c.json({ error: 'missing token' }, 400);

    const result = await withDataSession(await dataSessionOf(c), (yt) =>
      executeMutation(yt, 'feedback', { feedbackTokens: [token] }),
    );
    if (!result.success) {
      return c.json(
        { error: 'history item removal failed', upstreamStatus: result.statusCode },
        502,
      );
    }

    const scope = scopeOf(cookie);
    await deps.cache.delete?.(`history:${scope}`);
    await deps.cache.delete?.(`recents:${scope}`);
    await deps.cache.delete?.(`library:${scope}`);
    return c.json({ ok: true });
  });

  /* ---------------- browse (playlist/album/genre) ---------------- */

  app.get('/browse', async (c) => {
    const id = c.req.query('id')?.trim();
    if (!id) return c.json({ error: 'missing id' }, 400);
    const browseId = normalizeBrowseId(id);

    const json = await withDataSession(await dataSessionOf(c), async (yt) => {
      const data = await rawExecute(yt, '/browse', { browseId });
      const sections = parseBrowseSections(data);

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

      if (!browseId.startsWith('MPRE')) {
        const playlist = parsePlaylistLibraryState(data, browseId);
        return { sections, ...(playlist ? { playlist } : {}) };
      }

      // Album (MPRE): daftar lagu di halaman album sering terpotong tanpa
      // token continuation, sementara backing playlist-nya bisa di-paging.
      // Aturan BitChord: pakai hasil playlist HANYA kalau lebih lengkap —
      // yang lebih lengkap menang, bukan sumber yang lebih "resmi".
      const album = parseEntityHeader(data);
      const albumSongs = flattenSongItems(sections);
      let songs = albumSongs;
      let continuation: string | undefined;

      const backingId = album?.playlistId;
      if (backingId) {
        const plBrowse = `VL${backingId.replace(/^VL/, '')}`;
        try {
          const pl = await pagedBrowseSongs(yt, plBrowse, 5);
          if (pl.items.length > albumSongs.length) {
            songs = pl.items;
            continuation = pl.continuation;
          }
        } catch {
          // Backing playlist gagal (jarang) → halaman album tetap hidup dengan
          // lagu yang sudah terparse, jangan 500 halaman penuh.
        }
      }

      const playlist = parsePlaylistLibraryState(data, browseId);
      return {
        sections,
        ...(album ? { album } : {}),
        songs,
        ...(continuation ? { continuation } : {}),
        ...(playlist ? { playlist } : {}),
      };
    });
    return c.json(json);
  });

  /* ---------------- artist ---------------- */

  /** Halaman artis: songs + shelves yang di-expand lewat tombol More.
   *  Cookie opsional — artist page publik jalan anonim; cookie/visitor hanya
   *  memperkaya konten. Tanpa cache responsnya karena satu request artist
   *  memicu banyak browse (shelf) — hit ratio kecil, risiko cache basi besar. */
  app.get('/artist', async (c) => {
    const id = c.req.query('id')?.trim();
    if (!id) return c.json({ error: 'missing id' }, 400);
    // Artist page hidup di channel UC...; tolak bentuk lain agar browseId
    // tidak disalahgunakan untuk halaman non-artis.
    if (!id.startsWith('UC')) return c.json({ error: 'invalid artist id' }, 400);

    const opts = await dataSessionOf(c);
    const json = await withDataSession(opts, async (yt) => {
      const data = await rawExecute(yt, '/browse', { browseId: id });
      const shelves = parseArtistPageShelves(data);
      const artist = parseEntityHeader(data);

      // Songs artis — prioritas dari yang paling lengkap:
      // 1. playlist songs milik artis (paging penuh),
      // 2. continuation respons artist page (lanjutan shelf songs),
      // 3. lagu preview yang sudah ada di sections.
      let songs: ParsedItem[];
      if (shelves.songsPlaylistId) {
        songs = (
          await pagedBrowseSongs(yt, normalizeBrowseId(shelves.songsPlaylistId), 5)
        ).items;
      } else if (shelves.songsContinuation) {
        songs = flattenSongItems(shelves.sections);
        let token: string | undefined = shelves.songsContinuation;
        for (let page = 0; page < 5 && token; page++) {
          const pageData = await rawExecute(yt, '/browse', { continuation: token });
          songs.push(...flattenSongItems(parseContinuationSections(pageData)));
          token = extractContinuation(pageData);
        }
      } else {
        songs = flattenSongItems(shelves.sections);
      }

      // Expand tiap shelf yang punya tombol More (browse awal + maks 2 halaman
      // continuation). Semua shelf diparalelkan; satu shelf gagal dipakai apa
      // adanya dari preview — jangan gagalkan halaman artis karena satu shelf.
      const settled = await Promise.allSettled(
        shelves.sections.map(async (section) => {
          const more = section.more;
          try {
            let full: PagedItems;
            if (more?.playlistId) {
              full = await browsePagedItems(yt, normalizeBrowseId(more.playlistId), {
                maxPages: 3,
              });
            } else if (more?.browseId) {
              full = await browsePagedItems(yt, more.browseId, {
                ...(more.params ? { params: more.params } : {}),
                maxPages: 3,
              });
            } else {
              return section;
            }
            // Replace hanya bila hasil non-kosong — preview lebih baik daripada
            // shelf kosong kalau bentuk respons "More" tidak dikenali.
            return full.items.length ? { ...section, items: full.items } : section;
          } catch {
            return section;
          }
        }),
      );
      const sections = shelves.sections.map((section, index) => {
        const result = settled[index];
        return result.status === 'fulfilled' ? result.value : section;
      });

      return { ...(artist ? { artist } : {}), songs, sections };
    });
    return c.json(json);
  });

  /* ---------------- next / lyrics / player ---------------- */

  app.get('/next', async (c) => {
    const videoId = c.req.query('videoId')?.trim();
    if (!videoId) return c.json({ error: 'missing videoId' }, 400);
    const data = await withDataSession(await dataSessionOf(c), (yt) =>
      rawExecute(yt, '/next', {
        videoId,
        playlistId: `RDAMVM${videoId}`,
        isAudioOnly: true,
        tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
        watchEndpointMusicSupportedConfigs: {
          watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' },
        },
      }),
    );
    return c.json(parseNextResponse(data));
  });

  app.get('/lyrics', async (c) => {
    const videoId = c.req.query('videoId')?.trim();
    if (!videoId) return c.json({ error: 'missing videoId' }, 400);
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return c.json({ error: 'invalid videoId' }, 400);
    }

    return withDataSession(await dataSessionOf(c), async (yt) => {
      const nextData = await rawExecute(yt, '/next', {
        videoId,
        // watch-page format (no playlistId) exposes watchNextTabbedResultsRenderer
        // which contains the lyrics tab browseId — automix-only payload suppresses it.
        isAudioOnly: true,
        watchEndpointMusicSupportedConfigs: {
          watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' },
        },
      });
      const browseId = parseLyricsBrowseId(nextData);
      const queue = parseNextResponse(nextData).queue;
      const row =
        queue.find((item) => item.videoId === videoId && item.selected) ??
        queue.find((item) => item.videoId === videoId);
      const durationSec = row
        ? parseDurationSeconds(normalizeDuration(row.duration))
        : undefined;

      let lrclibResult: LrclibLookupResult | undefined;
      if (row && durationSec !== undefined) {
        const signature = normalizeLrclibSignature({
          title: row.title,
          artist: row.artist,
          durationSec,
        });

        if (signature.title && signature.artist) {
          const signatureKey = JSON.stringify([
            signature.title,
            signature.artist,
            signature.durationSec,
          ]);
          const cacheKey = `lyrics:lrclib:${hashStr(signatureKey)}`;
          const cached = await deps.cache.get<CachedLrclibResult>(cacheKey);

          if (cached?.signatureKey === signatureKey) {
            lrclibResult = cached.result;
          } else {
            const cooldown = await deps.cache.get<{ active: boolean }>(LRCLIB_COOLDOWN_KEY);
            if (cooldown?.active === true) {
              lrclibResult = { kind: 'unavailable' };
            } else {
              lrclibResult = await fetchExactLrclibLyrics(deps.fetch, signature);
              if (lrclibResult.kind === 'found') {
                await deps.cache.set<CachedLrclibResult>(
                  cacheKey,
                  { signatureKey, result: lrclibResult },
                  LRCLIB_FOUND_TTL_MS,
                );
              } else if (lrclibResult.kind === 'not-found') {
                await deps.cache.set<CachedLrclibResult>(
                  cacheKey,
                  { signatureKey, result: lrclibResult },
                  LRCLIB_NOT_FOUND_TTL_MS,
                );
              } else if (lrclibResult.retryAfterSec !== undefined) {
                await deps.cache.set(
                  LRCLIB_COOLDOWN_KEY,
                  { active: true },
                  Math.max(60, lrclibResult.retryAfterSec) * 1_000,
                );
              }
            }
          }

          if (lrclibResult.kind === 'found') {
            return c.json({ lyrics: lrclibResult.lyrics });
          }
        }
      }

      if (browseId) {
        const lyricsData = await rawExecute(yt, '/browse', { browseId });
        const ytmLyrics = parseLyricsResponse(lyricsData);
        if (ytmLyrics.lyrics) return c.json(ytmLyrics);
      }

      if (lrclibResult?.kind === 'unavailable') {
        return c.json({ error: 'lyrics temporarily unavailable' }, 503);
      }
      return c.json({ lyrics: null });
    });
  });

  app.get('/next/continue', async (c) => {
    const token = c.req.query('token')?.trim();
    if (!token) return c.json({ error: 'missing token' }, 400);
    const data = await withDataSession(await dataSessionOf(c), (yt) =>
      rawExecute(yt, '/next', { continuation: token }),
    );
    return c.json(parseNextResponse(data));
  });

  /** Stream URL untuk react-native-track-player (fetch langsung dari
   *  googlevideo oleh HP). CATATAN (PoC): X-Forwarded-For TIDAK mengubah
   *  binding `ip=` pada client WEB_REMIX — kalau HP kena 403, pakai /stream. */
  app.get('/player', async (c) => {
    const videoId = c.req.query('videoId')?.trim();
    if (!videoId) return c.json({ error: 'missing videoId' }, 400);

    const yt = await createPlaybackInnertube(deps, cookieOf(c), clientIpOf(c));
    const poToken = await deps.poToken?.getToken(videoId);
    const info = await yt.music.getInfo(videoId, poToken ? { po_token: poToken } : undefined);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const deciphered = await format.decipher(yt.session.player);
    const url = poToken ? `${deciphered}&pot=${encodeURIComponent(poToken)}` : deciphered;

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
    const poToken = await deps.poToken?.getToken(videoId);
    const info = await yt.music.getInfo(videoId, poToken ? { po_token: poToken } : undefined);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const deciphered = await format.decipher(yt.session.player);
    const url = poToken ? `${deciphered}&pot=${encodeURIComponent(poToken)}` : deciphered;

    // googlevideo menolak open-ended Range (`bytes=N-`) secara intermiten,
    // tetapi menerima bounded Range. Relay satu chunk per request; Media3 akan
    // meminta chunk berikutnya berdasarkan content-range.
    const clientRange = c.req.header('range');
    const upstream = await deps.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Range: upstreamRangeFor(clientRange, !!poToken),
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
  // Guard: watchEndpoint di top-result card kadang berisi params/token
  // non-videoId (bukan 11-char kanonik) — kalau lolos, /stream 500.
  const rawVid = nav?.watchEndpoint?.videoId;
  const videoId = rawVid && /^[A-Za-z0-9_-]{11}$/.test(rawVid) ? rawVid : undefined;
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


/** Playlist id perlu prefix VL untuk endpoint browse. */
export function normalizeBrowseId(id: string): string {
  if (/^(PL|RD|OLAK)/.test(id) && !id.startsWith('VL')) return `VL${id}`;
  return id;
}
