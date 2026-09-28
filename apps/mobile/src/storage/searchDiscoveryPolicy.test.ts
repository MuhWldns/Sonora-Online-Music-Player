import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localDayKey,
  MAX_DAILY_RECOMMENDATIONS,
  MAX_SEARCH_HISTORY,
  normalizeSearchQuery,
  rememberSearchQuery,
  removeSearchQuery,
  selectDailyRecommendations,
  type SearchHistoryEntry,
} from './searchDiscoveryPolicy';

interface Candidate {
  videoId?: string;
  title: string;
}

test('normalizes search whitespace and deduplicates case-insensitively by recency', () => {
  assert.equal(normalizeSearchQuery('  Miles   Davis\nKind '), 'Miles Davis Kind');

  let history: SearchHistoryEntry[] = [];
  history = rememberSearchQuery(history, '  Miles   Davis ', 10);
  history = rememberSearchQuery(history, 'Radiohead', 20);
  history = rememberSearchQuery(history, 'miles davis', 30);

  assert.deepEqual(history, [
    { query: 'miles davis', searchedAt: 30 },
    { query: 'Radiohead', searchedAt: 20 },
  ]);
});

test('bounds search history and ignores invalid entries', () => {
  let history: SearchHistoryEntry[] = [{ query: 'kept', searchedAt: 1 }];
  history = rememberSearchQuery(history, '   ', 2);
  history = rememberSearchQuery(history, 'ignored time', Number.NaN);
  assert.deepEqual(history, [{ query: 'kept', searchedAt: 1 }]);

  for (let index = 0; index < MAX_SEARCH_HISTORY + 5; index++) {
    history = rememberSearchQuery(history, `query ${index}`, index + 10);
  }
  assert.equal(history.length, MAX_SEARCH_HISTORY);
  assert.equal(history[0].query, `query ${MAX_SEARCH_HISTORY + 4}`);
  assert.equal(history.at(-1)?.query, 'query 5');
});

test('removes one normalized query without disturbing remaining recency', () => {
  const history: SearchHistoryEntry[] = [
    { query: 'Björk', searchedAt: 3 },
    { query: 'Massive Attack', searchedAt: 2 },
    { query: 'Portishead', searchedAt: 1 },
  ];
  assert.deepEqual(removeSearchQuery(history, ' massive   attack '), [
    { query: 'Björk', searchedAt: 3 },
    { query: 'Portishead', searchedAt: 1 },
  ]);
});

test('uses the local calendar date as the recommendation boundary', () => {
  assert.equal(localDayKey(new Date(2026, 8, 28, 23, 59, 59)), '2026-09-28');
  assert.equal(localDayKey(new Date(2026, 8, 29, 0, 0, 0)), '2026-09-29');
});

test('daily recommendations are valid, unique, bounded, and stable for one day', () => {
  const candidates: Candidate[] = [
    { videoId: 'AAAAAAAAAAA', title: 'A' },
    { videoId: 'BBBBBBBBBBB', title: 'B' },
    { videoId: 'CCCCCCCCCCC', title: 'C' },
    { videoId: 'DDDDDDDDDDD', title: 'D' },
    { videoId: 'EEEEEEEEEEE', title: 'E' },
    { videoId: 'FFFFFFFFFFF', title: 'F' },
    { videoId: 'GGGGGGGGGGG', title: 'G' },
    { videoId: 'HHHHHHHHHHH', title: 'H' },
    { videoId: 'AAAAAAAAAAA', title: 'duplicate A' },
    { videoId: 'bad', title: 'invalid' },
    { title: 'missing' },
  ];

  const first = selectDailyRecommendations(candidates, '2026-09-28');
  const repeated = selectDailyRecommendations([...candidates], '2026-09-28');
  assert.deepEqual(repeated, first);
  assert.equal(first.length, MAX_DAILY_RECOMMENDATIONS);
  assert.equal(new Set(first.map((item) => item.videoId)).size, first.length);
  assert.ok(first.every((item) => /^[A-Za-z0-9_-]{11}$/.test(item.videoId ?? '')));
});

test('daily recommendation ranking rotates across local days', () => {
  const candidates: Candidate[] = 'ABCDEFGHIJKL'.split('').map((letter) => ({
    videoId: letter.repeat(11),
    title: letter,
  }));
  const firstDay = selectDailyRecommendations(candidates, '2026-09-28', 4);
  const nextDay = selectDailyRecommendations(candidates, '2026-09-29', 4);
  assert.notDeepEqual(
    nextDay.map((item) => item.videoId),
    firstDay.map((item) => item.videoId),
  );
});
