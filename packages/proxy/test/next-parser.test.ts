import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNextResponse } from '../src/parsers.js';

const panel = (videoId: string) => ({
  playlistPanelVideoRenderer: {
    videoId,
    title: { runs: [{ text: `Song ${videoId}` }] },
    shortBylineText: { runs: [{ text: 'Artist' }] },
    lengthText: { simpleText: '3:00' },
    selected: false,
  },
});

test('parses queue and shelf continuation from an initial next response', () => {
  const parsed = parseNextResponse({
    contents: [panel('abcdefghijk')],
    musicShelfRenderer: {
      contents: [{ musicShelfContinuation: { token: 'page-2' } }],
    },
  });

  assert.equal(parsed.queue[0]?.videoId, 'abcdefghijk');
  assert.equal(parsed.continuation, 'page-2');
});

test('parses queue and endpoint continuation from a continuation response', () => {
  const parsed = parseNextResponse({
    contents: [panel('bcdefghijkl')],
    continuationItemRenderer: {
      endpoint: { continuationCommand: { token: 'page-3' } },
    },
  });

  assert.equal(parsed.queue[0]?.videoId, 'bcdefghijkl');
  assert.equal(parsed.continuation, 'page-3');
});

test('omits continuation when the upstream page has no next token', () => {
  const parsed = parseNextResponse({ contents: [panel('cdefghijklm')] });

  assert.deepEqual(parsed, {
    queue: [{
      videoId: 'cdefghijklm',
      title: 'Song cdefghijklm',
      artist: 'Artist',
      duration: '3:00',
      thumbnail: null,
      selected: false,
    }],
  });
});
