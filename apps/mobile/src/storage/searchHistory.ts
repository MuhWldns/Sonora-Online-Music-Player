import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  MAX_SEARCH_HISTORY,
  normalizeSearchQuery,
  rememberSearchQuery,
  removeSearchQuery,
  type SearchHistoryEntry,
} from './searchDiscoveryPolicy';

const KEY = '@sonora/search-history';

let cache: SearchHistoryEntry[] | null = null;
let loadPromise: Promise<SearchHistoryEntry[]> | null = null;
let writeChain: Promise<void> = Promise.resolve();

function validEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<SearchHistoryEntry>;
  return (
    typeof entry.query === 'string' &&
    normalizeSearchQuery(entry.query).length > 0 &&
    typeof entry.searchedAt === 'number' &&
    Number.isFinite(entry.searchedAt)
  );
}

async function readFromDisk(): Promise<SearchHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed
      .filter(validEntry)
      .sort((left, right) => left.searchedAt - right.searchedAt);
    let sanitized: SearchHistoryEntry[] = [];
    for (const value of valid) {
      sanitized = rememberSearchQuery(sanitized, value.query, value.searchedAt);
    }
    return sanitized.slice(0, MAX_SEARCH_HISTORY);
  } catch {
    return [];
  }
}

export async function getSearchHistory(): Promise<SearchHistoryEntry[]> {
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

export async function recordSearchQuery(
  query: string,
  searchedAt = Date.now(),
): Promise<SearchHistoryEntry[]> {
  writeChain = writeChain.then(async () => {
    const history = await getSearchHistory();
    cache = rememberSearchQuery(history, query, searchedAt);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // In-memory history remains available for this session.
    }
  }, () => undefined);
  await writeChain;
  return cache ?? [];
}

export async function deleteSearchQuery(query: string): Promise<SearchHistoryEntry[]> {
  writeChain = writeChain.then(async () => {
    const history = await getSearchHistory();
    cache = removeSearchQuery(history, query);
    try {
      if (cache.length > 0) await AsyncStorage.setItem(KEY, JSON.stringify(cache));
      else await AsyncStorage.removeItem(KEY);
    } catch {
      // In-memory history remains authoritative for this session.
    }
  }, () => undefined);
  await writeChain;
  return cache ?? [];
}

export async function clearSearchHistory(): Promise<void> {
  writeChain = writeChain.then(async () => {
    cache = [];
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Ignore persistence failure; the session cache is cleared.
    }
  }, () => undefined);
  await writeChain;
}
