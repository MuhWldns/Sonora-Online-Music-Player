import assert from 'node:assert/strict';
import test from 'node:test';

import { upstreamRangeFor } from './stream-range.js';

test('bounds a missing client range to the first relay chunk', () => {
  assert.equal(upstreamRangeFor(undefined), 'bytes=0-1048575');
});

test('bounds an open-ended client range to one relay chunk', () => {
  assert.equal(upstreamRangeFor('bytes=1048576-'), 'bytes=1048576-2097151');
});

test('preserves an already bounded client range', () => {
  assert.equal(upstreamRangeFor('bytes=1024-2047'), 'bytes=1024-2047');
});

test('uses complete ranges when a valid PO token unlocks the stream', () => {
  assert.equal(upstreamRangeFor(undefined, true), 'bytes=0-');
  assert.equal(upstreamRangeFor('bytes=1048576-', true), 'bytes=1048576-');
});
