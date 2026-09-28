import assert from 'node:assert/strict';
import test from 'node:test';

import type { Hono } from 'hono';

import { MemoryCache, type CacheAdapter } from '../src/cache.js';
import { createApp } from '../src/index.js';

const NOOP_CACHE: CacheAdapter = {
  async get() {
    return null;
  },
  async set() {},
};

const videoId = 'dQw4w9WgXcQ';
const secondVideoId = 'AzD3KphjQNQ';

type QueueRow = {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  selected?: boolean;
};

type ExecuteCall = {
  endpoint: string;
  args: Record<string, unknown>;
};

function nextResponse(rows: QueueRow[], browseId?: string): Record<string, unknown> {
  const tabs = browseId
    ? [{
        tabRenderer: {
          title: 'Lyrics',
          endpoint: {
            browseEndpoint: {
              browseId,
              browseEndpointContextSupportedConfigs: {
                browseEndpointContextMusicConfig: {
                  pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
                },
              },
            },
          },
        },
      }]
    : [];

  return {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: { tabs },
        },
      },
      playlistPanelRenderer: {
        contents: rows.map((row) => ({
          playlistPanelVideoRenderer: {
            videoId: row.videoId,
            title: { runs: [{ text: row.title }] },
            shortBylineText: { runs: [{ text: row.artist }] },
            lengthText: { simpleText: row.duration },
            selected: row.selected === true,
          },
        })),
      },
    },
  };
}

function plainLyricsResponse(text = 'Line one\r\nLine two'): Record<string, unknown> {
  return {
    contents: {
      musicDescriptionShelfRenderer: {
        description: { runs: [{ text }] },
        footer: { simpleText: 'Lyrics provided by YouTube Music' },
      },
    },
  };
}

function lrclibRecord(syncedLyrics = '[00:17.120] First line\n[00:20.500] Second line') {
  return {
    instrumental: false,
    duration: 234,
    syncedLyrics,
  };
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function makeApp(options: {
  cookie: string;
  execute: (endpoint: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
  fetch: typeof globalThis.fetch;
  cache?: CacheAdapter;
}) {
  const calls: ExecuteCall[] = [];
  const Innertube = {
    create: async (config: { cookie?: string }) => {
      assert.equal(config.cookie, options.cookie);
      return {
        session: {
          actions: {
            execute: async (endpoint: string, args: Record<string, unknown>) => {
              calls.push({ endpoint, args });
              const data = await options.execute(endpoint, args);
              return { data };
            },
          },
        },
      };
    },
  };

  return {
    app: createApp({
      Innertube: Innertube as never,
      cache: options.cache ?? NOOP_CACHE,
      fetch: options.fetch,
    }),
    calls,
  };
}

function requestLyrics(app: Hono, id: string, cookie: string) {
  return app.request(`http://proxy.test/lyrics?videoId=${id}`, {
    headers: { 'x-yt-cookie': cookie },
  });
}

test('lyrics route preserves missing and invalid videoId validation', async () => {
  const cookie = 'lyrics-validation-scope';
  const { app } = makeApp({
    cookie,
    execute: () => {
      throw new Error('InnerTube must not run for invalid input');
    },
    fetch: async () => {
      throw new Error('LRCLIB must not run for invalid input');
    },
  });

  const missing = await app.request('http://proxy.test/lyrics');
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'missing videoId' });

  const invalid = await app.request('http://proxy.test/lyrics?videoId=bad');
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'invalid videoId' });
});

test('selected exact /next row returns timed LRCLIB lyrics without a YTM browse', async () => {
  const cookie = 'lyrics-selected-row-scope';
  let providerCalls = 0;
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    providerCalls++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://lrclib.net/api/get');
    assert.equal(url.searchParams.get('track_name'), 'I Want to Live');
    assert.equal(url.searchParams.get('artist_name'), 'Borislav Slavov');
    assert.equal(url.searchParams.get('duration'), '234');
    const headers = new Headers(init?.headers);
    assert.equal(headers.has('x-yt-cookie'), false);
    return jsonResponse(lrclibRecord());
  };
  const { app, calls } = makeApp({
    cookie,
    fetch: fetchImpl,
    execute: (endpoint) => {
      assert.equal(endpoint, '/next');
      return nextResponse([
        {
          videoId,
          title: 'Wrong unselected title',
          artist: 'Wrong artist',
          duration: '1:00',
        },
        {
          videoId: 'aaaaaaaaaaa',
          title: 'Selected different queue item',
          artist: 'Must not be used',
          duration: '2:00',
          selected: true,
        },
        {
          videoId,
          title: '  I Want to   Live ',
          artist: ' Borislav\tSlavov ',
          duration: '3.54',
          selected: true,
        },
      ], 'MPLYt_verified');
    },
  });

  const response = await requestLyrics(app, videoId, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    lyrics: {
      lines: [
        { text: 'First line', startMs: 17_120, endMs: 20_500 },
        { text: 'Second line', startMs: 20_500 },
      ],
      synced: true,
      source: 'Lyrics provided by LRCLIB',
    },
  });
  assert.equal(providerCalls, 1);
  assert.deepEqual(calls.map((call) => call.endpoint), ['/next']);
});

test('LRCLIB 404 falls back to the existing YTM plain lyrics shelf', async () => {
  const cookie = 'lyrics-plain-fallback-scope';
  const { app, calls } = makeApp({
    cookie,
    fetch: async () => new Response(null, { status: 404 }),
    execute: (endpoint, args) => {
      if (endpoint === '/next') {
        return nextResponse([{
          videoId,
          title: 'Fallback song',
          artist: 'Fallback artist',
          duration: '3:54',
          selected: true,
        }], 'MPLYt_plain');
      }
      assert.equal(endpoint, '/browse');
      assert.equal(args.browseId, 'MPLYt_plain');
      return plainLyricsResponse();
    },
  });

  const response = await requestLyrics(app, videoId, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    lyrics: {
      lines: [{ text: 'Line one' }, { text: 'Line two' }],
      synced: false,
      source: 'Lyrics provided by YouTube Music',
    },
  });
  assert.deepEqual(calls.map((call) => call.endpoint), ['/next', '/browse']);
});

test('exact timed lyrics succeed even when the YTM lyrics tab is absent', async () => {
  const cookie = 'lyrics-no-tab-exact-scope';
  const { app, calls } = makeApp({
    cookie,
    fetch: async () => jsonResponse(lrclibRecord('[00:01.25] Exact line')),
    execute: (endpoint) => {
      assert.equal(endpoint, '/next');
      return nextResponse([{
        videoId,
        title: 'I Want to Live',
        artist: 'Borislav Slavov',
        duration: '3:54',
        selected: true,
      }]);
    },
  });

  const response = await requestLyrics(app, videoId, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    lyrics: {
      lines: [{ text: 'Exact line', startMs: 1_250 }],
      synced: true,
      source: 'Lyrics provided by LRCLIB',
    },
  });
  assert.deepEqual(calls.map((call) => call.endpoint), ['/next']);
});

test('confirmed provider miss and no YTM lyrics return HTTP 200 null', async () => {
  const cookie = 'lyrics-confirmed-empty-scope';
  const { app } = makeApp({
    cookie,
    fetch: async () => new Response(null, { status: 404 }),
    execute: () => nextResponse([{
      videoId,
      title: 'No lyrics song',
      artist: 'No lyrics artist',
      duration: '2:30',
      selected: true,
    }]),
  });

  const response = await requestLyrics(app, videoId, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { lyrics: null });
});

test('transient LRCLIB failure without YTM lyrics returns retryable HTTP 503', async () => {
  const cookie = 'lyrics-transient-scope';
  const { app } = makeApp({
    cookie,
    fetch: async () => new Response(null, { status: 503 }),
    execute: () => nextResponse([{
      videoId,
      title: 'Temporarily unavailable song',
      artist: 'Unavailable artist',
      duration: '4:10',
      selected: true,
    }]),
  });

  const response = await requestLyrics(app, videoId, cookie);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'lyrics temporarily unavailable' });
});

test('repeated normalized signature reuses the cached LRCLIB result', async () => {
  const cookie = 'lyrics-signature-cache-scope';
  let providerCalls = 0;
  const { app } = makeApp({
    cookie,
    cache: new MemoryCache(),
    fetch: async () => {
      providerCalls++;
      return jsonResponse(lrclibRecord('[00:02] Cached line'));
    },
    execute: () => nextResponse([{
      videoId,
      title: '  I Want to   Live ',
      artist: ' Borislav Slavov ',
      duration: '3:54',
      selected: true,
    }]),
  });

  const first = await requestLyrics(app, videoId, cookie);
  const second = await requestLyrics(app, videoId, cookie);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(providerCalls, 1);
});

test('LRCLIB 429 cooldown suppresses the next provider call and keeps YTM fallback', async () => {
  const cookie = 'lyrics-cooldown-scope';
  let providerCalls = 0;
  const { app } = makeApp({
    cookie,
    cache: new MemoryCache(),
    fetch: async () => {
      providerCalls++;
      return new Response(null, {
        status: 429,
        headers: { 'retry-after': '120' },
      });
    },
    execute: (endpoint, args) => {
      if (endpoint === '/next') {
        const requestedId = String(args.videoId);
        return nextResponse([{
          videoId: requestedId,
          title: requestedId === videoId ? 'First cooldown song' : 'Second cooldown song',
          artist: 'Cooldown artist',
          duration: '3:54',
          selected: true,
        }], `MPLYt_${requestedId}`);
      }
      assert.equal(endpoint, '/browse');
      return plainLyricsResponse(`Plain ${String(args.browseId)}`);
    },
  });

  const first = await requestLyrics(app, videoId, cookie);
  const second = await requestLyrics(app, secondVideoId, cookie);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), {
    lyrics: {
      lines: [{ text: `Plain MPLYt_${videoId}` }],
      synced: false,
      source: 'Lyrics provided by YouTube Music',
    },
  });
  assert.deepEqual(await second.json(), {
    lyrics: {
      lines: [{ text: `Plain MPLYt_${secondVideoId}` }],
      synced: false,
      source: 'Lyrics provided by YouTube Music',
    },
  });
  assert.equal(providerCalls, 1);
});
