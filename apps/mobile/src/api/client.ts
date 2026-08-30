/**
 * Proxy API client. Single place that knows the base URL and auth header.
 *
 * Cookie (YouTube account) is read from secure storage per-call and sent as
 * x-yt-cookie — the server is stateless and never stores it.
 */
import * as Keychain from 'react-native-keychain';

import type { HomeResponse, NextResponse, PlayerResponse, SearchResponse } from './types';

// TODO: make configurable in-app (settings screen). Default = production VPS.
const PROXY_BASE = 'http://45.198.149.134:2310';

const COOKIE_SERVICE = 'com.sonora-music.yt-cookie';

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

async function api<T>(path: string, params?: Record<string, string>): Promise<T> {
  const cookie = await getCookie();
  const url = new URL(`${PROXY_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: cookie ? { 'x-yt-cookie': cookie } : undefined,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`proxy ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const search = (q: string, filter?: string) =>
  api<SearchResponse>('/search', { q, ...(filter ? { filter } : {}) });

export const home = () => api<HomeResponse>('/home');

export const next = (videoId: string) => api<NextResponse>('/next', { videoId });

export const player = (videoId: string) => api<PlayerResponse>('/player', { videoId });

/** Playback source for track-player: relay via proxy (IP-safe fallback path). */
export const streamUrl = (videoId: string) => `${PROXY_BASE}/stream?videoId=${videoId}`;

export const healthz = () => api<{ ok: boolean; ts: number }>('/healthz');
