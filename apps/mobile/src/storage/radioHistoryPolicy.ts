/** Pure replay-rotation decisions and bounded history updates for radio queues. */

export interface RadioHistoryEntry {
  seed: string;
  videoIds: string[];
  updatedAt: number;
}

export interface RadioRecommendationDecision {
  appendIds: string[];
  reset: boolean;
  historyFiltered: boolean;
}

export const MAX_RADIO_HISTORY_SEEDS = 20;
export const MAX_RADIO_HISTORY_IDS = 100;

/**
 * Keep upstream order while excluding the live queue and this seed's used IDs.
 * A reset is allowed only when a page has candidates that history (rather than
 * the live queue) made unavailable; live duplicates remain duplicates.
 */
export function decideRadioRecommendations(
  candidateIds: readonly string[],
  liveIds: ReadonlySet<string>,
  rememberedIds: ReadonlySet<string>,
  allowReset: boolean,
): RadioRecommendationDecision {
  const filter = (history: ReadonlySet<string>): string[] => {
    const excluded = new Set(liveIds);
    for (const id of history) excluded.add(id);
    const selected: string[] = [];
    for (const id of candidateIds) {
      if (!id || excluded.has(id)) continue;
      excluded.add(id);
      selected.push(id);
    }
    return selected;
  };

  const appendIds = filter(rememberedIds);
  const historyFiltered = candidateIds.some(
    (id) => Boolean(id) && !liveIds.has(id) && rememberedIds.has(id),
  );
  if (appendIds.length > 0 || !allowReset) {
    return { appendIds, reset: false, historyFiltered };
  }
  if (!historyFiltered) return { appendIds: [], reset: false, historyFiltered };

  return { appendIds: filter(new Set<string>()), reset: true, historyFiltered };
}

/** Merge appended IDs into one seed's bounded, updated-at ordered history. */
export function rememberRadioRecommendations(
  history: readonly RadioHistoryEntry[],
  seed: string,
  videoIds: readonly string[],
  updatedAt: number,
  maxSeeds = MAX_RADIO_HISTORY_SEEDS,
  maxIdsPerSeed = MAX_RADIO_HISTORY_IDS,
): RadioHistoryEntry[] {
  if (!seed || maxSeeds <= 0 || maxIdsPerSeed <= 0) return history.slice();
  const current = history.find((entry) => entry.seed === seed);
  const appended = [...new Set(videoIds.filter(Boolean))];
  const previous = current?.videoIds ?? [];
  const appendedSet = new Set(appended);
  const ids = [
    ...previous.filter((id) => !appendedSet.has(id)),
    ...appended,
  ].slice(-maxIdsPerSeed);
  const next: RadioHistoryEntry = { seed, videoIds: ids, updatedAt };
  return [next, ...history.filter((entry) => entry.seed !== seed)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxSeeds);
}

export function resetRadioRecommendations(
  history: readonly RadioHistoryEntry[],
  seed: string,
): RadioHistoryEntry[] {
  return history.filter((entry) => entry.seed !== seed);
}

export function radioHistoryIds(
  history: readonly RadioHistoryEntry[],
  seed: string,
): ReadonlySet<string> {
  const entry = history.find((candidate) => candidate.seed === seed);
  return new Set(entry?.videoIds ?? []);
}
