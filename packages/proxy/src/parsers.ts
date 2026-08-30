/**
 * Parser response InnerTube (YTM) → JSON bersih untuk app.
 * Di-port dari pola Rich Music (raw-JSON walk, terbukti stabil lintas
 * perubahan layout) — TIDAK bergantung pada node-class youtubei.js,
 * sehingga imun terhadap churn SuperParsedResult antar versi.
 */

/* ---------------- deep helpers ---------------- */
export function findAll<T = unknown>(obj: unknown, key: string, out: T[] = []): T[] {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const v of obj) findAll(v, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) out.push(v as T);
    findAll(v, key, out);
  }
  return out;
}

export const findFirst = <T = unknown>(obj: unknown, key: string): T | undefined =>
  findAll<T>(obj, key)[0];

interface Runs {
  runs?: { text: string }[];
  simpleText?: string;
}

export const text = (o?: Runs): string =>
  o?.runs ? o.runs.map((r) => r.text).join('') : (o?.simpleText ?? '');

export function normalizeDuration(s: string): string {
  const t = String(s ?? '').trim();
  return /^\d{1,2}(\.\d{2}){1,2}$/.test(t) ? t.replace(/\./g, ':') : t;
}

interface NavRun {
  text: string;
  navigationEndpoint?: NavigationEndpoint;
}
export interface ParsedPerson {
  name: string;
  browseId?: string;
}

export function runsInfo(o?: Runs): ParsedPerson[] {
  const out: ParsedPerson[] = [];
  if (!o?.runs) return out;
  for (const r of o.runs as NavRun[]) {
    const be = r.navigationEndpoint?.browseEndpoint;
    if (be) out.push({ name: r.text, browseId: be.browseId });
  }
  return out;
}

interface Thumb {
  url: string;
  width?: number;
}

export function thumbs(o: unknown): string | null {
  const t = findAll<Thumb[]>(o, 'thumbnails')
    .flat()
    .filter((x) => x?.url);
  if (!t.length) return null;
  const best = t.reduce((a, b) => ((b.width ?? 0) >= (a.width ?? 0) ? b : a));
  return upscale(best.url);
}

function upscale(url: string): string {
  if (url.includes('googleusercontent.com')) {
    return url.replace(/=w\d+-h\d+.*$/, '=w544-h544-l90-rj');
  }
  return url;
}

interface NavigationEndpoint {
  watchEndpoint?: { videoId: string; playlistId?: string };
  watchPlaylistEndpoint?: { playlistId: string };
  browseEndpoint?: { browseId: string; params?: string };
}

export interface EndpointInfo {
  videoId?: string;
  playlistId?: string;
  watchPlaylist?: boolean;
  browseId?: string;
  browseType?: 'album' | 'artist' | 'playlist';
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function endpointInfo(nav?: NavigationEndpoint): EndpointInfo {
  if (!nav) return {};
  const { watchEndpoint: we, browseEndpoint: be, watchPlaylistEndpoint: wpe } = nav;
  if (we) {
    // Guard invalid videoId di navigation endpoint (renderer non-song
    // kadang isi field ini dengan blob yang bukan videoId 11-char).
    const vid = we.videoId && VIDEO_ID_RE.test(we.videoId) ? we.videoId : undefined;
    return { videoId: vid, playlistId: we.playlistId };
  }
  if (wpe) return { playlistId: wpe.playlistId, watchPlaylist: true };
  if (be) {
    const id = be.browseId;
    let type: EndpointInfo['browseType'] = undefined;
    if (id.startsWith('MPRE')) type = 'album';
    else if (id.startsWith('UC') || id.startsWith('MPLA')) type = 'artist';
    else if (id.startsWith('VL') || id.startsWith('PL') || id.startsWith('RDCLAK'))
      type = 'playlist';
    return { browseId: id, browseType: type };
  }
  return {};
}

/* ---------------- item parsers ---------------- */

export interface ParsedItem {
  type: string;
  title: string;
  subtitle?: string;
  thumbnail: string | null;
  artists?: ParsedPerson[];
  album?: ParsedPerson | null;
  duration?: string;
  videoId?: string;
  playlistId?: string;
  browseId?: string;
  browseType?: string;
  watchPlaylist?: boolean;
}

interface TwoRowRenderer {
  navigationEndpoint?: NavigationEndpoint;
  title?: Runs;
  subtitle?: Runs;
  thumbnailRenderer?: unknown;
}

export function parseTwoRow(r: TwoRowRenderer): ParsedItem | null {
  const info = { ...endpointInfo(r.navigationEndpoint) };
  if (!info.browseId && r.title?.runs) {
    const tNav = (r.title.runs as NavRun[])[0]?.navigationEndpoint;
    const extra = endpointInfo(tNav);
    if (extra.browseId) Object.assign(info, extra);
  }
  let type = 'song';
  if (info.browseType) type = info.browseType;
  else if (info.videoId) type = 'song';
  else if (info.playlistId || info.watchPlaylist) type = 'playlist';
  const item: ParsedItem = {
    type,
    title: text(r.title),
    subtitle: text(r.subtitle),
    thumbnail: thumbs(r.thumbnailRenderer),
    artists: runsInfo(r.subtitle),
    ...info,
  };
  const mtr = findFirst<{ thumbnailCrop?: string }>(r, 'musicThumbnailRenderer');
  if (mtr?.thumbnailCrop === 'MUSIC_THUMBNAIL_CROP_CIRCLE') item.type = 'artist';
  return item.title ? item : null;
}

interface ListItemRenderer {
  flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: Runs } }[];
  playlistItemData?: { videoId: string };
  overlay?: unknown;
  navigationEndpoint?: NavigationEndpoint;
  thumbnail?: unknown;
}

export function parseListItem(r: ListItemRenderer): ParsedItem | null {
  const cols = (r.flexColumns ?? []).map(
    (c) => c.musicResponsiveListItemFlexColumnRenderer?.text ?? null,
  );
  const title = cols[0] ? text(cols[0]) : '';
  const subtitle = cols
    .slice(1)
    .map((c) => text(c ?? undefined))
    .filter(Boolean)
    .join(' • ');

  // YouTube videoId kanonik: exactly 11 chars A-Z/a-z/0-9/-/_. Fallback path
  // (overlay.watchEndpoint, cols[0].runs) kadang pungut blob dari renderer
  // lain — kalau lolos ke client, /stream 500 ("This video is unavailable").
  const takeIfValid = (v: string | null | undefined): string | null =>
    v && VIDEO_ID_RE.test(v) ? v : null;

  let videoId = takeIfValid(r.playlistItemData?.videoId);
  if (!videoId && cols[0]?.runs) {
    const we = (cols[0].runs as NavRun[])[0]?.navigationEndpoint?.watchEndpoint;
    videoId = takeIfValid(we?.videoId);
  }
  if (!videoId) {
    const we = findFirst<NavigationEndpoint>(r.overlay ?? {}, 'watchEndpoint') as
      | { videoId: string }
      | undefined;
    videoId = takeIfValid(we?.videoId);
  }

  const navInfo = endpointInfo(r.navigationEndpoint);
  const artists: ParsedPerson[] = [];
  const albums: ParsedPerson[] = [];
  for (const c of cols.slice(1)) {
    for (const e of runsInfo(c ?? undefined)) {
      if (e.browseId?.startsWith('MPRE')) albums.push(e);
      else artists.push(e);
    }
  }
  const type = videoId ? 'song' : (navInfo.browseType ?? 'song');
  const item: ParsedItem = {
    type,
    title,
    subtitle,
    videoId: videoId ?? undefined,
    thumbnail: thumbs(r.thumbnail),
    artists,
    album: albums[0] ?? null,
    ...navInfo,
  };
  const fixed = findFirst<{ text?: Runs }>(r, 'musicResponsiveListItemFixedColumnRenderer');
  if (fixed?.text) item.duration = normalizeDuration(text(fixed.text));
  return item.title ? item : null;
}

export interface ParsedSection {
  title: string;
  items: ParsedItem[];
  list?: boolean;
}

interface SectionContainer {
  musicCarouselShelfRenderer?: {
    header?: unknown;
    contents?: Record<string, never>[];
  };
  musicShelfRenderer?: { title?: Runs; contents?: Record<string, never>[] };
}

export function parseSections(contents: SectionContainer[] = []): ParsedSection[] {
  const sections: ParsedSection[] = [];
  for (const s of contents) {
    const car = s.musicCarouselShelfRenderer;
    const shelf = s.musicShelfRenderer;
    if (car) {
      const header = findFirst<Runs>(car.header, 'title');
      const items = (car.contents ?? [])
        .map((c) => {
          const two = (c as { musicTwoRowItemRenderer?: TwoRowRenderer })
            .musicTwoRowItemRenderer;
          if (two) return parseTwoRow(two);
          const list = (c as { musicResponsiveListItemRenderer?: ListItemRenderer })
            .musicResponsiveListItemRenderer;
          return list ? parseListItem(list) : null;
        })
        .filter((x): x is ParsedItem => x !== null);
      if (items.length) sections.push({ title: text(header), items });
    } else if (shelf) {
      const items = (shelf.contents ?? [])
        .map((c) => {
          const list = (c as { musicResponsiveListItemRenderer?: ListItemRenderer })
            .musicResponsiveListItemRenderer;
          return list ? parseListItem(list) : null;
        })
        .filter((x): x is ParsedItem => x !== null);
      if (items.length)
        sections.push({ title: text(shelf.title), items, list: true });
    }
  }
  return sections;
}
