/**
 * Proxy API client. Single place that knows the base URL and auth header.
 *
 * Cookie (YouTube account) is read from secure storage per-call and sent as
 * x-yt-cookie — the server is stateless and never stores it.
 * Proxy base URL is user-configurable (Settings), persisted in AsyncStorage,
 * default = empty; configure a proxy URL in Settings or via EXPO_PUBLIC_PROXY_BASE.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import type { BrowseResponse, HomeResponse, NextResponse, PlayerResponse, SearchResponse } from './types';

const configuredProxyBase = process.env.EXPO_PUBLIC_PROXY_BASE;
export const DEFAULT_PROXY_BASE =
  typeof configuredProxyBase === 'string' ? configuredProxyBase.trim() : '';

const COOKIE_SERVICE = 'com.sonora-music.yt-cookie';
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

export async function api<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const base = await getProxyBase();
  const cookie = await getCookie();
  const url = new URL(`${base}${path}`);
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

export const browse = (id: string) => api<BrowseResponse>('/browse', { id });

export const next = (videoId: string) => api<NextResponse>('/next', { videoId });

export const player = (videoId: string) => api<PlayerResponse>('/player', { videoId });

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
