import assert from 'node:assert/strict';
import test from 'node:test';

import { stopAndReleasePlayer } from './lifecycle';

test('pauses and releases the previous native player before switching tracks', () => {
  const calls: string[] = [];
  const player = {
    pause: () => calls.push('pause'),
    remove: () => calls.push('remove'),
    release: () => calls.push('release'),
  };

  stopAndReleasePlayer(player);

  assert.deepEqual(calls, ['pause', 'remove', 'release']);
});
