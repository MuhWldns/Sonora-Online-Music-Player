import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchExactLrclibLyrics,
  normalizeLrclibSignature,
  parseDurationSeconds,
  parseSyncedLyrics,
} from '../src/lrclib.js';

const signature = {
  title: 'I Want to Live',
  artist: 'Borislav Slavov',
  durationSec: 234,
};

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

test('normalizes exact signatures and normalized whole-second durations', () => {
  assert.deepEqual(
    normalizeLrclibSignature({
      title: '  Café\t del   Mar  ',
      artist: '\nBjörk　 Guðmundsdóttir ',
      durationSec: 234,
    }),
    {
      title: 'Café del Mar',
      artist: 'Björk Guðmundsdóttir',
      durationSec: 234,
    },
  );

  const accepted: Record<string, number> = {
    '0:01': 1,
    '3:54': 234,
    '59:59': 3_599,
    '60:00': 3_600,
    '0:00:01': 1,
    '0:59:59': 3_599,
    '1:00:00': 3_600,
  };
  for (const [value, expected] of Object.entries(accepted)) {
    assert.equal(parseDurationSeconds(value), expected, value);
  }

  for (const value of [
    '',
    '0:00',
    '3:4',
    ' 3:54 ',
    '3.54',
    '1:60',
    '1:00:60',
    '1:60:00',
    '60:01',
    '1:00:01',
    '-1:30',
    '3:54.5',
  ]) {
    assert.equal(parseDurationSeconds(value), undefined, value);
  }
});

test('parses, stably orders, and bounds synchronized LRC lines', () => {
  const lines = parseSyncedLyrics([
    '[01:02] Whole second',
    '[00:05.25] Centisecond first',
    '[00:05.250] Millisecond duplicate',
    '[00:07.004]   ',
    '[00:08.4] Tenth',
    '[00:09.04] Hundredth',
    '[ar:Ignored metadata]',
    '[00:60.00] Invalid seconds',
    '[00:10.1234] Invalid fraction',
    'prefix [00:11.000] Not leading',
    '[60:00.000] Last allowed',
    '[60:00.001] Too late',
  ].join('\r\n'));

  assert.deepEqual(lines, [
    { text: 'Centisecond first', startMs: 5_250, endMs: 7_004 },
    { text: 'Millisecond duplicate', startMs: 5_250, endMs: 7_004 },
    { text: '', startMs: 7_004, endMs: 8_400 },
    { text: 'Tenth', startMs: 8_400, endMs: 9_040 },
    { text: 'Hundredth', startMs: 9_040, endMs: 62_000 },
    { text: 'Whole second', startMs: 62_000, endMs: 3_600_000 },
    { text: 'Last allowed', startMs: 3_600_000 },
  ]);
});

test('fetches only the exact LRCLIB record with the required query and client header', async () => {
  let calls = 0;
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://lrclib.net/api/get');
    assert.deepEqual([...url.searchParams.entries()], [
      ['track_name', 'I Want to Live'],
      ['artist_name', 'Borislav Slavov'],
      ['duration', '234'],
    ]);
    const headers = new Headers(init?.headers);
    assert.equal(
      headers.get('lrclib-client'),
      'Sonora-Music-Lyrics/1.0 (https://github.com/MuhWldns/Sonora-Online-Music-Player)',
    );
    assert.equal(headers.has('x-yt-cookie'), false);
    assert.ok(init?.signal);

    return jsonResponse({
      instrumental: false,
      duration: 233.6,
      syncedLyrics: '[00:17.120] First line\n[00:20.5] Second line',
      plainLyrics: 'ignored',
    });
  };

  assert.deepEqual(await fetchExactLrclibLyrics(fetchImpl, signature), {
    kind: 'found',
    lyrics: {
      lines: [
        { text: 'First line', startMs: 17_120, endMs: 20_500 },
        { text: 'Second line', startMs: 20_500 },
      ],
      synced: true,
      source: 'Lyrics provided by LRCLIB',
    },
  });
  assert.equal(calls, 1);
});

test('classifies exact misses without using plain lyrics', async () => {
  const responses = [
    new Response(null, { status: 404 }),
    jsonResponse({ instrumental: true, duration: 234, syncedLyrics: null }),
    jsonResponse({ instrumental: false, duration: 237, syncedLyrics: '[00:01] Mismatch' }),
    jsonResponse({
      instrumental: false,
      duration: 234,
      syncedLyrics: null,
      plainLyrics: 'Plain lyrics are deliberately ignored',
    }),
    jsonResponse({ instrumental: false, duration: 234, syncedLyrics: '[ar:No timed lines]' }),
  ];
  let index = 0;
  const fetchImpl: typeof globalThis.fetch = async () => responses[index++];

  for (let responseIndex = 0; responseIndex < responses.length; responseIndex++) {
    assert.deepEqual(await fetchExactLrclibLyrics(fetchImpl, signature), { kind: 'not-found' });
  }
});

test('classifies transient failures and Retry-After cooldowns', async () => {
  const responses = [
    new Response(null, { status: 503 }),
    new Response('{', { status: 200 }),
    jsonResponse({ instrumental: false, duration: '234', syncedLyrics: '[00:01] Bad shape' }),
    new Response(null, { status: 429, headers: { 'retry-after': '125' } }),
    new Response(null, { status: 429, headers: { 'retry-after': 'later' } }),
  ];
  let index = 0;
  const fetchImpl: typeof globalThis.fetch = async () => responses[index++];

  assert.deepEqual(await fetchExactLrclibLyrics(fetchImpl, signature), { kind: 'unavailable' });
  assert.deepEqual(await fetchExactLrclibLyrics(fetchImpl, signature), { kind: 'unavailable' });
  assert.deepEqual(await fetchExactLrclibLyrics(fetchImpl, signature), { kind: 'unavailable' });
  assert.deepEqual(await fetchExactLrclibLyrics(fetchImpl, signature), {
    kind: 'unavailable',
    retryAfterSec: 125,
  });
  assert.deepEqual(await fetchExactLrclibLyrics(fetchImpl, signature), {
    kind: 'unavailable',
    retryAfterSec: 60,
  });

  const networkFailure: typeof globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  assert.deepEqual(await fetchExactLrclibLyrics(networkFailure, signature), {
    kind: 'unavailable',
  });
});
