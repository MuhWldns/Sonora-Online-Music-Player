import assert from 'node:assert/strict';
import test from 'node:test';

import type { CacheAdapter } from '../src/cache.js';
import { createApp } from '../src/index.js';
import {
  canonicalPlaylistId,
  normalizePlaylistTitle,
  parsePlaylistLibraryState,
} from '../src/playlists.js';

const NOOP_CACHE: CacheAdapter = {
  async get() {
    return null;
  },
  async set() {},
};

interface ExecuteCall {
  endpoint: string;
  args: Record<string, unknown>;
}

function makeApp(
  cookie: string,
  execute: (endpoint: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
) {
  const calls: ExecuteCall[] = [];
  let createCalls = 0;
  const Innertube = {
    create: async (config: { cookie?: string }) => {
      createCalls++;
      assert.equal(config.cookie, cookie);
      return {
        session: {
          actions: {
            execute: async (endpoint: string, args: Record<string, unknown>) => {
              calls.push({ endpoint, args });
              return execute(endpoint, args);
            },
          },
        },
      };
    },
  };

  return {
    app: createApp({
      Innertube: Innertube as never,
      cache: NOOP_CACHE,
      fetch: globalThis.fetch,
    }),
    calls,
    createCalls: () => createCalls,
  };
}

function authenticatedJson(method: string, body?: unknown, cookie = 'playlist-cookie') {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      'x-yt-cookie': cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

test('playlist validators canonicalize browse IDs and reject unsafe input', () => {
  assert.equal(canonicalPlaylistId(' VLPLabc_123 '), 'PLabc_123');
  assert.equal(canonicalPlaylistId('VLRDAMVMdQw4w9WgXcQ'), 'RDAMVMdQw4w9WgXcQ');
  assert.equal(canonicalPlaylistId('MPREb_album'), null);
  assert.equal(canonicalPlaylistId('../PLbad'), null);

  assert.equal(normalizePlaylistTitle('  Road trip  '), 'Road trip');
  assert.equal(normalizePlaylistTitle(''), null);
  assert.equal(normalizePlaylistTitle(`Bad\nname`), null);
  assert.equal(normalizePlaylistTitle('x'.repeat(151)), null);
});

test('create playlist requires authentication before parsing or calling InnerTube', async () => {
  const { app, createCalls } = makeApp('create-auth-cookie', () => {
    throw new Error('must not execute');
  });

  const response = await app.request('http://proxy.test/playlists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json',
  });

  assert.equal(response.status, 401);
  assert.equal(createCalls(), 0);
});

test('create playlist validates and trims the title before the exact private mutation', async () => {
  const cookie = 'create-success-cookie';
  const { app, calls } = makeApp(cookie, () => ({
    success: true,
    status_code: 200,
    data: { playlistId: 'PLcreated_123' },
  }));

  const invalid = await app.request(
    'http://proxy.test/playlists',
    authenticatedJson('POST', { title: '   ' }, cookie),
  );
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);

  const response = await app.request(
    'http://proxy.test/playlists',
    authenticatedJson('POST', { title: '  Focus set  ' }, cookie),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { playlistId: 'PLcreated_123' });
  assert.deepEqual(calls, [
    {
      endpoint: 'playlist/create',
      args: {
        client: 'YTMUSIC',
        parse: false,
        title: 'Focus set',
        privacyStatus: 'PRIVATE',
        videoIds: [],
      },
    },
  ]);
});

test('create playlist maps rejected or malformed upstream results to 502', async () => {
  const cookie = 'create-rejected-cookie';
  const { app } = makeApp(cookie, () => ({
    success: false,
    status_code: 403,
    data: {},
  }));

  const response = await app.request(
    'http://proxy.test/playlists',
    authenticatedJson('POST', { title: 'Denied' }, cookie),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'playlist creation failed',
    upstreamStatus: 403,
  });
});

test('save and remove playlist use canonical IDs and exact like endpoints', async () => {
  const cookie = 'library-mutation-cookie';
  const { app, calls } = makeApp(cookie, () => ({
    success: true,
    status_code: 200,
    data: {},
  }));

  const save = await app.request(
    'http://proxy.test/library/playlists/VLPLsaved_123',
    authenticatedJson('PUT', undefined, cookie),
  );
  assert.equal(save.status, 200);
  assert.deepEqual(await save.json(), { playlistId: 'PLsaved_123', saved: true });

  const remove = await app.request(
    'http://proxy.test/library/playlists/PLsaved_123',
    authenticatedJson('DELETE', undefined, cookie),
  );
  assert.equal(remove.status, 200);
  assert.deepEqual(await remove.json(), { playlistId: 'PLsaved_123', saved: false });
  assert.deepEqual(calls, [
    {
      endpoint: 'like/like',
      args: { client: 'YTMUSIC', parse: false, target: 'PLsaved_123' },
    },
    {
      endpoint: 'like/removelike',
      args: { client: 'YTMUSIC', parse: false, target: 'PLsaved_123' },
    },
  ]);
});

test('playlist library mutations reject anonymous and invalid requests without InnerTube', async () => {
  const cookie = 'library-validation-cookie';
  const { app, calls, createCalls } = makeApp(cookie, () => {
    throw new Error('must not execute');
  });

  const anonymous = await app.request('http://proxy.test/library/playlists/PLvalid_123', {
    method: 'PUT',
  });
  assert.equal(anonymous.status, 401);

  const invalid = await app.request(
    'http://proxy.test/library/playlists/MPREb_album',
    authenticatedJson('PUT', undefined, cookie),
  );
  assert.equal(invalid.status, 400);
  assert.equal(createCalls(), 0);
  assert.equal(calls.length, 0);
});

test('playlist state requires a matching save/remove toggle and ignores video likes', () => {
  const data = {
    header: {
      musicDetailHeaderRenderer: {
        buttons: [
          {
            toggleButtonRenderer: {
              isToggled: false,
              defaultServiceEndpoint: {
                likeEndpoint: { status: 'LIKE', target: { videoId: 'dQw4w9WgXcQ' } },
              },
              toggledServiceEndpoint: {
                likeEndpoint: {
                  status: 'INDIFFERENT',
                  target: { videoId: 'dQw4w9WgXcQ' },
                },
              },
            },
          },
          {
            toggleButtonRenderer: {
              isToggled: true,
              defaultServiceEndpoint: {
                likeEndpoint: { status: 'LIKE', target: { playlistId: 'PLsaved_123' } },
              },
              toggledServiceEndpoint: {
                likeEndpoint: {
                  status: 'INDIFFERENT',
                  target: { playlistId: 'PLsaved_123' },
                },
              },
            },
          },
        ],
      },
    },
  };

  assert.deepEqual(parsePlaylistLibraryState(data, 'VLPLsaved_123'), {
    id: 'PLsaved_123',
    saved: true,
  });
  assert.equal(parsePlaylistLibraryState(data, 'PLdifferent_123'), undefined);
});

test('browse returns authoritative playlist library state when present', async () => {
  const cookie = 'browse-playlist-state-cookie';
  const { app, calls } = makeApp(cookie, () => ({
    data: {
      header: {
        musicDetailHeaderRenderer: {
          buttons: [
            {
              toggleButtonRenderer: {
                isToggled: false,
                defaultServiceEndpoint: {
                  likeEndpoint: { status: 'LIKE', target: 'PLbrowse_123' },
                },
                toggledServiceEndpoint: {
                  likeEndpoint: { status: 'INDIFFERENT', target: 'PLbrowse_123' },
                },
              },
            },
          ],
        },
      },
    },
  }));

  const response = await app.request('http://proxy.test/browse?id=PLbrowse_123', {
    headers: { 'x-yt-cookie': cookie },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sections: [],
    playlist: { id: 'PLbrowse_123', saved: false },
  });
  assert.deepEqual(calls, [
    {
      endpoint: '/browse',
      args: { client: 'YTMUSIC', browseId: 'VLPLbrowse_123' },
    },
  ]);
});
