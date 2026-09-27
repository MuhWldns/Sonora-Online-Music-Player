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
  musicCarouselShelfRenderer?: { header?: unknown; contents?: Record<string, never>[] };
  musicShelfRenderer?: { title?: Runs; contents?: Record<string, never>[] };
  musicPlaylistShelfRenderer?: { playlistId?: string; header?: unknown; contents?: Record<string, never>[] };
}

function parseContents(contents: Record<string, never>[] | undefined): ParsedItem[] {
  return (contents ?? [])
    .map((c) => {
      const two = (c as { musicTwoRowItemRenderer?: TwoRowRenderer }).musicTwoRowItemRenderer;
      if (two) return parseTwoRow(two);
      const list = (c as { musicResponsiveListItemRenderer?: ListItemRenderer })
        .musicResponsiveListItemRenderer;
      return list ? parseListItem(list) : null;
    })
    .filter((x): x is ParsedItem => x !== null);
}

export function parseSections(contents: SectionContainer[] = []): ParsedSection[] {
  const sections: ParsedSection[] = [];
  for (const s of contents) {
    const car = s.musicCarouselShelfRenderer;
    const shelf = s.musicShelfRenderer;
    const playlist = s.musicPlaylistShelfRenderer;
    if (car) {
      const items = parseContents(car.contents);
      if (items.length) sections.push({ title: text(findFirst<Runs>(car.header, 'title')), items });
    } else if (shelf) {
      const items = parseContents(shelf.contents);
      if (items.length) sections.push({ title: text(shelf.title), items, list: true });
    } else if (playlist) {
      const items = parseContents(playlist.contents);
      if (items.length) sections.push({ title: text(findFirst<Runs>(playlist.header, 'title')), items, list: true });
    }
  }
  return sections;
}

export function parseBrowseSections(data: unknown): ParsedSection[] {
  const lists = findAll<{ contents?: SectionContainer[] }>(data, 'sectionListRenderer');
  const sections = lists.flatMap((list) => parseSections(list.contents ?? []));
  return sections.filter((section, index) => sections.findIndex((s) => s.title === section.title) === index);
}
export interface NextQueueItem {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string | null;
  selected: boolean;
}

export interface ParsedNextResponse {
  queue: NextQueueItem[];
  continuation?: string;
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

/**
 * InnerTube uses several renderer/container names for the same automix
 * continuation. Keep the token extraction beside queue parsing so /next and
 * /next/continue cannot drift as response layouts change.
 */
function nextContinuation(data: unknown): string | undefined {
  for (const continuation of findAll<Record<string, unknown>>(data, 'musicShelfContinuation')) {
    const token = stringField(continuation, 'token');
    if (token) return token;
  }

  for (const item of findAll<Record<string, unknown>>(data, 'continuationItemRenderer')) {
    for (const endpointKey of ['endpoint', 'continuationEndpoint']) {
      const endpoint = item[endpointKey];
      if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) continue;
      const command = (endpoint as Record<string, unknown>).continuationCommand;
      const token = stringField(command, 'token');
      if (token) return token;
    }
  }

  for (const command of findAll<Record<string, unknown>>(data, 'continuationCommand')) {
    const token = stringField(command, 'token');
    if (token) return token;
  }

  for (const nextData of findAll<Record<string, unknown>>(data, 'nextContinuationData')) {
    const token = stringField(nextData, 'continuation') ?? stringField(nextData, 'token');
    if (token) return token;
  }

  return undefined;
}

function parsePanelItem(p: Record<string, unknown>): NextQueueItem {
  return {
    videoId: p.videoId as string,
    title: text(p.title as Runs),
    artist: text((p.shortBylineText ?? p.longBylineText) as Runs),
    duration: text(p.lengthText as Runs),
    thumbnail: thumbs(p.thumbnail),
    selected: !!p.selected,
  };
}

/** Parse both the queue page and the token for the following upstream page. */
export function parseNextResponse(data: unknown): ParsedNextResponse {
  const queue = findAll<Record<string, unknown>>(data, 'playlistPanelVideoRenderer').map(
    (panel) => parsePanelItem(panel),
  );
  const continuation = nextContinuation(data);
  return continuation ? { queue, continuation } : { queue };
}

export interface LyricsLine {
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface ParsedLyrics {
  lines: LyricsLine[];
  synced: boolean;
  source?: string;
}

export interface LyricsResponse {
  lyrics: ParsedLyrics | null;
}

interface LyricsText {
  runs?: { text?: string }[];
  simpleText?: string;
}

const lyricsText = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const candidate = value as LyricsText;
  if (Array.isArray(candidate.runs)) {
    return candidate.runs.map((run) => (typeof run.text === 'string' ? run.text : '')).join('');
  }
  return typeof candidate.simpleText === 'string' ? candidate.simpleText : '';
};

function normalizedLyricsLines(value: unknown): LyricsLine[] {
  const normalized = lyricsText(value).replace(/\r\n?/g, '\n');
  if (!normalized) return [];
  return normalized.split('\n').map((line) => ({ text: line }));
}

function lyricsBrowseIdFromTab(tab: unknown): string | undefined {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return undefined;
  const renderer = (tab as Record<string, unknown>).tabRenderer;
  if (!renderer || typeof renderer !== 'object' || Array.isArray(renderer)) return undefined;
  const endpoint = (renderer as Record<string, unknown>).endpoint;
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return undefined;
  const browse = (endpoint as Record<string, unknown>).browseEndpoint;
  if (!browse || typeof browse !== 'object' || Array.isArray(browse)) return undefined;
  const config = (browse as Record<string, unknown>).browseEndpointContextSupportedConfigs;
  const musicConfig = config && typeof config === 'object' && !Array.isArray(config)
    ? (config as Record<string, unknown>).browseEndpointContextMusicConfig
    : undefined;
  const pageType = musicConfig && typeof musicConfig === 'object' && !Array.isArray(musicConfig)
    ? (musicConfig as Record<string, unknown>).pageType
    : undefined;
  const browseId = (browse as Record<string, unknown>).browseId;
  return pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && typeof browseId === 'string' && browseId
    ? browseId
    : undefined;
}

/** Find the verified YTM lyrics tab endpoint in a raw /next response. */
export function parseLyricsBrowseId(data: unknown): string | undefined {
  for (const wrapper of findAll<Record<string, unknown>>(data, 'watchNextTabbedResultsRenderer')) {
    const tabs = wrapper.tabs;
    if (!Array.isArray(tabs)) continue;
    for (const tab of tabs) {
      const browseId = lyricsBrowseIdFromTab(tab);
      if (browseId) return browseId;
    }
  }
  return undefined;
}

function firstLyricsShelf(data: unknown): Record<string, unknown> | undefined {
  for (const shelf of findAll<Record<string, unknown>>(data, 'musicDescriptionShelfRenderer')) {
    return shelf;
  }
  return undefined;
}

/** Parse the plain-text MusicDescriptionShelf returned by the YTM lyrics browse. */
export function parseLyricsResponse(data: unknown): LyricsResponse {
  const shelf = firstLyricsShelf(data);
  if (shelf) {
    const lines = normalizedLyricsLines(shelf.description);
    if (!lines.length) return { lyrics: null };
    const sourceText = lyricsText(shelf.footer).replace(/\r\n?/g, '\n').trim();
    return {
      lyrics: {
        lines,
        synced: false,
        ...(sourceText ? { source: sourceText } : {}),
      },
    };
  }

  // YTM uses a messageRenderer for unavailable lyrics; do not expose its copy.
  if (findAll(data, 'messageRenderer').length > 0) return { lyrics: null };
  return { lyrics: null };
}
