/**
 * Proxy API client. Single place that knows the base URL and auth header.
 *
 * Cookie (YouTube account) is read from secure storage per-call and sent as
 * x-yt-cookie — the server is stateless and never stores it.
 * Channel pageId terpilih disimpan terpisah (service keychain sendiri) dan
 * dikirim sebagai x-yt-user: server memakainya sebagai onBehalfOfUser supaya
 * library/history dibaca dari channel yang dipilih, bukan channel utama.
 * Visitor data TIDAK dikirim dari mobile — server resolve sendiri, jadi
 * konfigurasi sisi client tetap minimum.
 * Proxy base URL is user-configurable (Settings), persisted in AsyncStorage,
 * default = empty; configure a proxy URL in Settings or via EXPO_PUBLIC_PROXY_BASE.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import type {
  AddPlaylistItemsResponse,
  AuthSessionResponse,
  BrowseResponse,
  CreatePlaylistResponse,
  EditPlaylistInput,
  HistoryResponse,
  HomeResponse,
  LyricsResponse,
  NextResponse,
  OkResponse,
  PlayerResponse,
  PlaylistLibraryMutationResponse,
  PlaylistLibraryState,
  PagedItems,
  RecentsResponse,
  ArtistResponse,
  SearchResponse,
} from './types';

const configuredProxyBase = process.env.EXPO_PUBLIC_PROXY_BASE;
export const DEFAULT_PROXY_BASE =
  typeof configuredProxyBase === 'string' ? configuredProxyBase.trim() : '';

const COOKIE_SERVICE = 'com.sonora-music.yt-cookie';
const USER_SERVICE = 'com.sonora-music.yt-user';
const PROXY_BASE_KEY = '@sonora/proxy-base';

let proxyBase: string | null = null; // resolved lazily, cached in memory

export async function getProxyBase(): Promise<string> {
  if (proxyBase) return proxyBase;
  const stored = await AsyncStorage.getItem(PROXY_BASE_KEY);
  proxyBase = stored && stored.length > 0 ? stored : DEFAULT_PROXY_BASE;
  return proxyBase;
}

export async function setProxyBase(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  proxyBase = trimmed.length ? trimmed : DEFAULT_PROXY_BASE;
  await AsyncStorage.setItem(PROXY_BASE_KEY, proxyBase);
}

export async function getCookie(): Promise<string | null> {
  const creds = await Keychain.getGenericPassword({ service: COOKIE_SERVICE });
  return creds ? creds.password : null;
}

export async function setCookie(cookie: string): Promise<void> {
  await Keychain.setGenericPassword('yt', cookie, { service: COOKIE_SERVICE });
}

export async function clearCookie(): Promise<void> {
  await Keychain.resetGenericPassword({ service: COOKIE_SERVICE });
}

/** pageId channel terpilih (header x-yt-user). Service keychain terpisah dari
 *  cookie supaya mengganti channel tidak pernah menyentuh credential akun. */
export async function getUserChannel(): Promise<string | null> {
  const creds = await Keychain.getGenericPassword({ service: USER_SERVICE });
  return creds ? creds.password : null;
}

export async function setUserChannel(pageId: string): Promise<void> {
  await Keychain.setGenericPassword('yt', pageId, { service: USER_SERVICE });
}

export async function clearUserChannel(): Promise<void> {
  await Keychain.resetGenericPassword({ service: USER_SERVICE });
}

async function request<T>(
  path: string,
  params: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const base = await getProxyBase();
  const cookie = await getCookie();
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const headers = new Headers(cookie ? { 'x-yt-cookie': cookie } : undefined);
  const pageId = await getUserChannel();
  // Header channel hanya dikirim bila user memilih channel non-utama; tanpa
  // itu server memakai channel utama (onBehalfOfUser tidak di-set).
  if (pageId) headers.set('x-yt-user', pageId);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(url.toString(), {
    method,
    headers,
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => '');
    throw new Error(`proxy ${res.status}: ${responseBody.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function api<T>(
  path: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>(path, params, signal, 'GET');
}


export const search = (q: string, filter?: string) =>
  api<SearchResponse>('/search', { q, ...(filter ? { filter } : {}) });

export const home = () => api<HomeResponse>('/home');

export const history = () => api<HistoryResponse>('/history');

export const historyContinue = (token: string) =>
  api<HistoryResponse>('/history/continue', { token });

/** Hapus satu item history pakai feedbackToken dari item itu sendiri
 *  (bukan videoId — server butuh token feedback InnerTube untuk mutasi). */
export const removeHistoryItem = (feedbackToken: string) =>
  request<OkResponse>('/history', { token: feedbackToken }, undefined, 'DELETE');

export const browse = (id: string) => api<BrowseResponse>('/browse', { id });

/* ---------- Auth/session ---------- */

/** 200 = cookie valid; 401 = cookie invalid (throw 'proxy 401…'). */
export const authSession = () => api<AuthSessionResponse>('/auth/session');

/* ---------- Library (bentuk baru) ---------- */

export const recents = () => api<RecentsResponse>('/library/recents');

export const librarySongs = () => api<PagedItems>('/library/songs');

export const librarySongsContinue = (token: string) =>
  api<PagedItems>('/library/songs/continue', { token });

export const artist = (id: string) => api<ArtistResponse>('/artist', { id });

/* ---------- Playlist mutasi ---------- */

export const addPlaylistItems = (playlistId: string, videoIds: string[]) =>
  request<AddPlaylistItemsResponse>(
    `/playlists/${encodeURIComponent(playlistId)}/items`,
    undefined,
    undefined,
    'POST',
    { videoIds },
  );

export const removePlaylistItems = (playlistId: string, setVideoIds: string[]) =>
  request<OkResponse>(
    `/playlists/${encodeURIComponent(playlistId)}/items`,
    undefined,
    undefined,
    'DELETE',
    { setVideoIds },
  );

export const editPlaylist = (playlistId: string, input: EditPlaylistInput) =>
  request<OkResponse>(
    `/playlists/${encodeURIComponent(playlistId)}`,
    undefined,
    undefined,
    'PATCH',
    input,
  );

export const deletePlaylist = (playlistId: string) =>
  request<OkResponse>(
    `/playlists/${encodeURIComponent(playlistId)}`,
    undefined,
    undefined,
    'DELETE',
  );

export const next = (videoId: string) => api<NextResponse>('/next', { videoId });

export const nextContinue = (token: string) =>
  api<NextResponse>('/next/continue', { token });

export const player = (videoId: string) => api<PlayerResponse>('/player', { videoId });

export const lyrics = (videoId: string, signal?: AbortSignal) =>
  api<LyricsResponse>('/lyrics', { videoId }, signal);

export const createPlaylist = (title: string) =>
  request<CreatePlaylistResponse>('/playlists', undefined, undefined, 'POST', { title });

export async function setPlaylistSaved(
  playlistId: string,
  saved: boolean,
): Promise<PlaylistLibraryState> {
  const result = await request<PlaylistLibraryMutationResponse>(
    `/library/playlists/${encodeURIComponent(playlistId)}`,
    undefined,
    undefined,
    saved ? 'PUT' : 'DELETE',
  );
  return { id: result.playlistId, saved: result.saved };
}

/** Playback source: relay via proxy (IP-safe fallback path). videoId
 * di-encode karena bisa mengandung karakter URL-unsafe walau format
 * kanonik YouTube (A-Z/a-z/0-9/-/_) — defensive terhadap parser bug
 * yang bisa nyasarkan blob non-videoId ke slot ini. */
export async function streamUrl(videoId: string): Promise<string> {
  return `${await getProxyBase()}/stream?videoId=${encodeURIComponent(videoId)}`;
}

export const healthz = (base?: string) =>
  base !== undefined
    ? fetch(`${base.replace(/\/+$/, '')}/healthz`).then(async (r) => {
        if (!r.ok) throw new Error(`proxy ${r.status}`);
        return (await r.json()) as { ok: boolean; ts: number };
      })
    : api<{ ok: boolean; ts: number }>('/healthz');
