export interface SearchHistoryEntry {
  query: string;
  searchedAt: number;
}

export interface DailyRecommendationCandidate {
  videoId?: string;
}

export const MAX_SEARCH_HISTORY = 12;
export const MAX_DAILY_RECOMMENDATIONS = 6;

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

export function rememberSearchQuery(
  history: readonly SearchHistoryEntry[],
  query: string,
  searchedAt: number,
  limit = MAX_SEARCH_HISTORY,
): SearchHistoryEntry[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized || !Number.isFinite(searchedAt) || limit <= 0) return history.slice();
  const key = normalized.toLowerCase();
  return [
    { query: normalized, searchedAt },
    ...history.filter((entry) => normalizeSearchQuery(entry.query).toLowerCase() !== key),
  ].slice(0, limit);
}

export function removeSearchQuery(
  history: readonly SearchHistoryEntry[],
  query: string,
): SearchHistoryEntry[] {
  const key = normalizeSearchQuery(query).toLowerCase();
  if (!key) return history.slice();
  return history.filter((entry) => normalizeSearchQuery(entry.query).toLowerCase() !== key);
}

/** Local calendar day: recommendations remain stable until local midnight. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** FNV-1a: stable unsigned ranking across JS runtimes; not used for security. */
function dailyRank(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function selectDailyRecommendations<T extends DailyRecommendationCandidate>(
  candidates: readonly T[],
  dayKey: string,
  limit = MAX_DAILY_RECOMMENDATIONS,
): T[] {
  if (!dayKey || limit <= 0) return [];
  const unique = new Map<string, T>();
  for (const item of candidates) {
    const videoId = item.videoId?.trim() ?? '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || unique.has(videoId)) continue;
    unique.set(videoId, item);
  }

  return [...unique.entries()]
    .map(([videoId, item]) => ({ item, rank: dailyRank(`${dayKey}\0${videoId}`), videoId }))
    .sort((left, right) => left.rank - right.rank || left.videoId.localeCompare(right.videoId))
    .slice(0, limit)
    .map(({ item }) => item);
}
