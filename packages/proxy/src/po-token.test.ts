import assert from 'node:assert/strict';
import test from 'node:test';

import { CachedPoTokenProvider } from './po-token.js';

test('deduplicates concurrent token minting for one video', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const provider = new CachedPoTokenProvider(async (videoId) => {
    calls++;
    await gate;
    return `${videoId}-token`;
  }, 60_000);

  const first = provider.getToken('video12345A');
  const second = provider.getToken('video12345A');
  release();

  assert.equal(await first, 'video12345A-token');
  assert.equal(await second, 'video12345A-token');
  assert.equal(calls, 1);
});

test('reuses a minted token until its cache expires', async () => {
  let calls = 0;
  let now = 1_000;
  const provider = new CachedPoTokenProvider(async () => `token-${++calls}`, 100, () => now);

  assert.equal(await provider.getToken('video12345A'), 'token-1');
  now = 1_099;
  assert.equal(await provider.getToken('video12345A'), 'token-1');
  now = 1_101;
  assert.equal(await provider.getToken('video12345A'), 'token-2');
});
