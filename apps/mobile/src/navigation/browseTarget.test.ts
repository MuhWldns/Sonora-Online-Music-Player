import assert from 'node:assert/strict';
import test from 'node:test';

import type { ParsedItem } from '../api/types';
import { browseTargetOf } from './browseTarget';

const base: ParsedItem = { type: 'playlist', title: 'Mix', thumbnail: null };

test('uses browseId for album and artist cards', () => {
  assert.equal(browseTargetOf({ ...base, browseId: 'MPRE_album' }), 'MPRE_album');
});

test('falls back to playlistId for playlist cards', () => {
  assert.equal(browseTargetOf({ ...base, playlistId: 'PL123' }), 'PL123');
});

test('does not navigate cards without a browse target', () => {
  assert.equal(browseTargetOf(base), undefined);
});
