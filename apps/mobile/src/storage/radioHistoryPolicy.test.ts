import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideRadioRecommendations,
  MAX_RADIO_HISTORY_IDS,
  MAX_RADIO_HISTORY_SEEDS,
  radioHistoryIds,
  rememberRadioRecommendations,
} from './radioHistoryPolicy';

test('filters remembered and live IDs without changing upstream order', () => {
  const result = decideRadioRecommendations(
    ['used', 'live', 'new-2', 'new-1', 'new-2'],
    new Set(['live']),
    new Set(['used']),
    false,
  );
  assert.deepEqual(result, {
    appendIds: ['new-2', 'new-1'],
    reset: false,
    historyFiltered: true,
  });
});

test('records appended IDs only and bounds IDs plus seed LRU', () => {
  let history = rememberRadioRecommendations([], 'seed-a', ['a-1', 'a-2'], 1, 2, 2);
  history = rememberRadioRecommendations(history, 'seed-b', ['b-1'], 2, 2, 2);
  history = rememberRadioRecommendations(history, 'seed-a', ['a-3'], 3, 2, 2);
  history = rememberRadioRecommendations(history, 'seed-c', ['c-1'], 4, 2, 2);

  assert.equal(history.length, MAX_RADIO_HISTORY_SEEDS > 2 ? 2 : MAX_RADIO_HISTORY_SEEDS);
  assert.deepEqual(history.map((entry) => entry.seed), ['seed-c', 'seed-a']);
  assert.deepEqual([...radioHistoryIds(history, 'seed-a')], ['a-2', 'a-3']);
  assert.ok(history.every((entry) => entry.videoIds.length <= MAX_RADIO_HISTORY_IDS));
});

test('resets once when all unseen candidates are exhausted, preserving order', () => {
  const remembered = new Set(['a', 'b']);
  const exhausted = decideRadioRecommendations(['a', 'b', 'a'], new Set(['seed']), remembered, true);
  assert.deepEqual(exhausted.appendIds, ['a', 'b']);
  assert.equal(exhausted.reset, true);

  const next = decideRadioRecommendations(['a', 'b', 'seed'], new Set(['seed']), remembered, false);
  assert.deepEqual(next.appendIds, []);
  assert.equal(next.reset, false);
  assert.equal(next.historyFiltered, true);
});
