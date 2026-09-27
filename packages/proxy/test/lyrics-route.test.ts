import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../src/index.js';
import type { CacheAdapter } from '../src/cache.js';

const cache: CacheAdapter = {
  async get() {
    return null;
  },
  async set() {},
};

const videoId = 'dQw4w9WgXcQ';

function lyricsTabResponse() {
  return {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [{
              tabRenderer: {
                title: 'Lyrics',
                endpoint: {
                  browseEndpoint: {
                    browseId: 'MPLYt_verified',
                    browseEndpointContextSupportedConfigs: {
                      browseEndpointContextMusicConfig: {
                        pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
                      },
                    },
                  },
                },
              },
            }],
          },
        },
      },
    },
  };
}

test('lyrics route follows watch-next tab to browse and returns a clean contract', async () => {
  const calls: { endpoint: string; args: Record<string, unknown> }[] = [];
  const Innertube = {
    create: async () => ({
      session: {
        actions: {
          execute: async (endpoint: string, args: Record<string, unknown>) => {
            calls.push({ endpoint, args });
            if (endpoint === '/next') return { data: lyricsTabResponse() };
            assert.equal(endpoint, '/browse');
            assert.equal(args.browseId, 'MPLYt_verified');
            return {
              data: {
                contents: {
                  musicDescriptionShelfRenderer: {
                    description: {
                      runs: [{ text: 'Line one\r\nLine two' }],
                    },
                    footer: { simpleText: 'Lyrics provided by YouTube Music' },
                  },
                },
              },
            };
          },
        },
      },
    }),
  };
  const app = createApp({ Innertube: Innertube as never, cache });

  const missing = await app.request('http://proxy.test/lyrics');
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'missing videoId' });
  const invalid = await app.request('http://proxy.test/lyrics?videoId=bad');
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'invalid videoId' });

  const response = await app.request(`http://proxy.test/lyrics?videoId=${videoId}`, {
    headers: { 'x-yt-cookie': 'cookie-per-request' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    lyrics: {
      lines: [{ text: 'Line one' }, { text: 'Line two' }],
      synced: false,
      source: 'Lyrics provided by YouTube Music',
    },
  });
  assert.deepEqual(calls.map((call) => call.endpoint), ['/next', '/browse']);
  assert.equal(calls[0]?.args.client, 'YTMUSIC');
  assert.equal(calls[0]?.args.videoId, videoId);
});

test('lyrics route returns HTTP 200 null when no lyrics tab exists', async () => {
  const Innertube = {
    create: async () => ({
      session: {
        actions: {
          execute: async () => ({ data: { contents: {} } }),
        },
      },
    }),
  };
  const app = createApp({ Innertube: Innertube as never, cache });
  const response = await app.request('http://proxy.test/lyrics?videoId=dQw4w9WgXcQ');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { lyrics: null });
});
