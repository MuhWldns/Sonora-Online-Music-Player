/**
 * Types matching proxy response shapes (packages/proxy/src/parsers.ts).
 * Keep in sync with the proxy contract.
 */

export interface ParsedPerson {
  name: string;
  browseId?: string;
}

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
  /** Hanya untuk item yang butuh mutasi akun (playlist add / history remove).
   *  Server baru mengirimnya di /library/recents, /history dan /library/songs. */
  setVideoId?: string;
  feedbackToken?: string;
}

export interface ParsedSection {
  title: string;
  items: ParsedItem[];
  list?: boolean;
  /** Hanya section di /artist: target navigasi "lihat semua" dari kartu shelf
   *  (browseId/params atau langsung playlistId). Opsional — home tidak punya. */
  more?: { browseId?: string; params?: string; playlistId?: string };
}

export interface SearchResponse {
  sections: ParsedSection[];
}

export interface HomeResponse {
  sections: ParsedSection[];
}

export interface HistoryResponse {
  sections: ParsedSection[];
  /** Token paging server-side (dedupe per videoId). Absen = halaman terakhir. */
  continuation?: string;
}

export interface PlaylistLibraryState {
  id: string;
  saved: boolean;
}

export interface BrowseResponse {
  sections: ParsedSection[];
  playlist?: PlaylistLibraryState;
  /** Kontrak baru: hanya ada saat browse album. Keys lama tetap dikirim. */
  album?: { title: string; subtitle?: string; thumbnail: string | null; playlistId?: string };
  songs?: ParsedItem[];
  continuation?: string;
}

/* ---------- Auth/session ---------- */

export interface AuthProfile {
  name: string;
  email?: string;
  thumbnail: string | null;
}

export interface AuthChannel {
  /** null = akun utama (tanpa onBehalfOfUser). */
  id: string | null;
  name: string;
  thumbnail: string | null;
  selected: boolean;
}

/** 200 = cookie valid; 401 = cookie invalid (server-side). */
export interface AuthSessionResponse {
  profile: AuthProfile;
  channels: AuthChannel[];
  valid: true;
}

/* ---------- Library (bentuk baru) ---------- */

/** Recents: lagu dedupe, max 20. Item bisa punya feedbackToken untuk mutasi. */
export interface RecentsResponse {
  items: ParsedItem[];
}

export type LibraryCollectionKey =
  | 'liked'
  | 'songs'
  | 'albums'
  | 'artists'
  | 'subscriptions'
  | 'playlists';

/** Satu koleksi. Continuation opsional — mobile boleh mengabaikannya. */
export interface LibraryCollection {
  items: ParsedItem[];
  continuation?: string;
}

/** Koleksi kosong tidak ada key-nya, makanya Partial. */
export interface LibraryResponse {
  collections: Partial<Record<LibraryCollectionKey, LibraryCollection>>;
}

/** Halaman item generik untuk endpoint paging server-side. */
export interface PagedItems {
  items: ParsedItem[];
  continuation?: string;
}

/* ---------- Artist ---------- */

export interface ArtistResponse {
  artist?: { title: string; subtitle?: string; thumbnail: string | null };
  songs: ParsedItem[];
  sections: ParsedSection[];
}

/* ---------- Playlist mutasi ---------- */

/** Suffix generik untuk semua endpoint yang cuma menjawab ok. */
export interface OkResponse {
  ok: true;
}

export interface PlaylistItemResult {
  videoId?: string;
  setVideoId?: string;
}

export interface AddPlaylistItemsResponse {
  results: PlaylistItemResult[];
}

/** PATCH /playlists/:id — kirim salah satu atau keduanya (title dan/atau reorder). */
export interface EditPlaylistInput {
  title?: string;
  /** Pasangan reorder: urutan videoId saat ini dan urutan target.
   *  Diff dihitung server-side. */
  current?: string[];
  target?: string[];
}

export interface CreatePlaylistResponse {
  playlistId: string;
}

export interface PlaylistLibraryMutationResponse {
  playlistId: string;
  saved: boolean;
}

export interface QueueItem {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string | null;
  selected: boolean;
}

export interface NextResponse {
  queue: QueueItem[];
  /** Token for paging the automix past the first ~25 items. Undefined when
   *  YTM does not return one (queue shorter than a page). */
  continuation?: string;
}

export interface PlayerResponse {
  videoId: string;
  url: string;
  mimeType: string;
  bitrate: number;
  audioQuality: string;
  title: string;
  artist: string;
  durationMs: number;
}

export interface LyricsLine {
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface Lyrics {
  lines: LyricsLine[];
  synced: boolean;
  source?: string;
}

export interface LyricsResponse {
  lyrics: Lyrics | null;
}
