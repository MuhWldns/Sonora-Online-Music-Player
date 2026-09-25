/**
 * Recently-played tracks. Local-only history: every time a track actually
 * starts playing (i.e. the native Media3 player is in playing state for it),
 * we push it to the head of this list. Used to render Home rows without any
 * InnerTube login requirement.
 *
 * Persisted to AsyncStorage under `@sonora/recently-played` as a JSON array
 * newest-first, capped at MAX entries, deduplicated by videoId.
 *
 * The store keeps an in-memory snapshot so subscribers get a sync read on
 * mount and Home does not hit AsyncStorage on every focus. Writes are
 * fire-and-forget — failing to persist must never block or fail a play.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface RecentlyPlayed {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  playedAt: number; // ms epoch
}

const KEY = '@sonora/recently-played';
const MAX = 30;
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

let cache: RecentlyPlayed[] | null = null;
let loaded = false;
const listeners = new Set<(items: RecentlyPlayed[]) => void>();

function notify(): void {
  for (const fn of listeners) fn(cache ?? []);
}

async function loadFromDisk(): Promise<RecentlyPlayed[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentlyPlayed =>
          x &&
          typeof x.videoId === 'string' &&
          typeof x.title === 'string' &&
          typeof x.playedAt === 'number',
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Read the current snapshot. Returns [] until the first load completes. */
export function getRecentlyPlayed(): RecentlyPlayed[] {
  return cache ?? [];
}

/** Set of currently cached videoIds. Empty set if not yet loaded.
 *  Used by callers that need O(1) membership tests for merge/dedup
 *  without re-iterating the full array. */
export function recentVideoIds(): ReadonlySet<string> {
  if (!cache) return EMPTY_SET;
  const set = new Set<string>();
  for (const item of cache) set.add(item.videoId);
  return set;
}

/** Subscribe to changes. Listener fires on every successful write. */
export function subscribeRecentlyPlayed(listener: (items: RecentlyPlayed[]) => void): () => void {
  listeners.add(listener);
  // Kick off an initial load if we haven't already; later reads return synchronously.
  if (!loaded) void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

/** Idempotent first-load. Safe to call many times. */
export async function ensureLoaded(): Promise<RecentlyPlayed[]> {
  if (loaded) return cache ?? [];
  loaded = true;
  cache = await loadFromDisk();
  notify();
  return cache;
}

/** Push an item to the head. Dedupes by videoId and caps at MAX.
 *  Fire-and-forget: errors are swallowed. Returns the post-write snapshot. */
export async function recordPlayed(entry: RecentlyPlayed): Promise<RecentlyPlayed[]> {
  if (!loaded) {
    cache = await loadFromDisk();
    loaded = true;
  }
  const filtered = (cache ?? []).filter((x) => x.videoId !== entry.videoId);
  const next = [entry, ...filtered].slice(0, MAX);
  cache = next;
  notify();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Persistence failure: in-memory cache stays correct for this session.
  }
  return next;
}

/** Test-only / Settings affordance. */
export async function clearRecentlyPlayed(): Promise<void> {
  cache = [];
  loaded = true;
  notify();
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}