import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  MAX_RADIO_HISTORY_IDS,
  MAX_RADIO_HISTORY_SEEDS,
  radioHistoryIds,
  rememberRadioRecommendations,
  resetRadioRecommendations,
  type RadioHistoryEntry,
} from './radioHistoryPolicy';

const KEY = '@sonora/radio-history';

let cache: RadioHistoryEntry[] | null = null;
let loadPromise: Promise<RadioHistoryEntry[]> | null = null;
let writeChain: Promise<void> = Promise.resolve();

function validEntry(value: unknown): value is RadioHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<RadioHistoryEntry>;
  return (
    typeof entry.seed === 'string' &&
    entry.seed.length > 0 &&
    Array.isArray(entry.videoIds) &&
    entry.videoIds.every((id) => typeof id === 'string' && id.length > 0) &&
    typeof entry.updatedAt === 'number' &&
    Number.isFinite(entry.updatedAt)
  );
}

async function readFromDisk(): Promise<RadioHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(validEntry);
    return entries
      .map((entry) => ({
        seed: entry.seed,
        videoIds: [...new Set(entry.videoIds)].slice(-MAX_RADIO_HISTORY_IDS),
        updatedAt: entry.updatedAt,
      }))
      .filter((entry) => entry.videoIds.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RADIO_HISTORY_SEEDS);
  } catch {
    return [];
  }
}

async function ensureLoaded(): Promise<RadioHistoryEntry[]> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = readFromDisk().then((loaded) => {
      cache = loaded;
      return loaded;
    });
  }
  try {
    return await loadPromise;
  } catch {
    cache = [];
    return cache;
  } finally {
    loadPromise = null;
  }
}

/** Best-effort read. Corrupt/unavailable storage behaves as empty history. */
export async function getRadioHistoryIds(seed: string): Promise<ReadonlySet<string>> {
  const history = await ensureLoaded();
  return radioHistoryIds(history, seed);
 }
export async function recordRadioRecommendations(
  seed: string,
  videoIds: readonly string[],
  updatedAt = Date.now(),
): Promise<void> {
  if (!seed || videoIds.length === 0) return;
  writeChain = writeChain.then(async () => {
    const history = await ensureLoaded();
    const next = rememberRadioRecommendations(history, seed, videoIds, updatedAt);
    cache = next;
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Playback remains usable with the in-memory snapshot.
    }
  }, () => undefined);
  await writeChain;
}

export async function resetRadioHistory(
  seed: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!seed || !isCurrent()) return;
  writeChain = writeChain.then(async () => {
    if (!isCurrent()) return;
    const history = await ensureLoaded();
    if (!isCurrent()) return;
    cache = resetRadioRecommendations(history, seed);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // Playback remains usable with the in-memory snapshot.
    }
  }, () => undefined);
  await writeChain;
}

/** Test/settings seam; not used by playback. */
export async function clearRadioHistory(): Promise<void> {
  writeChain = writeChain.then(async () => {
    cache = [];
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Ignore storage failures.
    }
  }, () => undefined);
  await writeChain;
}
