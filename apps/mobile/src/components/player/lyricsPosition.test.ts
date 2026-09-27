import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeLineIndex,
  focusScrollOffset,
  nearestTimedIndex,
} from './lyricsPosition';
import type { TimedLine } from './lyricsPosition';

const synced: TimedLine[] = [
  { text: 'line one', startMs: 0, endMs: 4000 },
  { text: 'line two', startMs: 4000, endMs: 8000 },
  { text: 'line three', startMs: 8000, endMs: 12000 },
  { text: 'line four', startMs: 12000, endMs: 16000 },
];

test('activeLineIndex returns -1 before the first timed line', () => {
  const lines: TimedLine[] = [{ text: 'later', startMs: 5000 }];
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 4999), -1);
  assert.equal(activeLineIndex([], 1000), -1);
});

test('activeLineIndex tracks the line owning the position', () => {
  assert.equal(activeLineIndex(synced, 0), 0);
  assert.equal(activeLineIndex(synced, 2000), 0);
  assert.equal(activeLineIndex(synced, 3999), 0);
  assert.equal(activeLineIndex(synced, 4000), 1);
  assert.equal(activeLineIndex(synced, 11000), 2);
  assert.equal(activeLineIndex(synced, 99999), 3);
});

test('activeLineIndex skips untimed lines but keeps their slots', () => {
  const lines: TimedLine[] = [
    { text: 'timed a', startMs: 1000 },
    { text: 'untimed middle' },
    { text: 'timed b', startMs: 2000 },
  ];
  assert.equal(activeLineIndex(lines, 1500), 0);
  assert.equal(activeLineIndex(lines, 2500), 2);
  // Untimed line never becomes active itself.
  assert.notEqual(activeLineIndex(lines, 1500), 1);
});

test('activeLineIndex holds the last timed line past the end', () => {
  assert.equal(activeLineIndex(synced, 60000), 3);
});

test('focusScrollOffset centers the focused line in the viewport', () => {
  // pitch 60, viewport 400, top padding 24:
  // line 2 center = 24 + 2*60 + 30 = 174; offset = 174 - 200 = 0 (clamped).
  assert.equal(focusScrollOffset(2, 60, 400, 24), 0);
  // line 10 center = 24 + 600 + 30 = 654; offset = 454.
  assert.equal(focusScrollOffset(10, 60, 400, 24), 454);
});

test('focusScrollOffset never scrolls above the content origin', () => {
  assert.equal(focusScrollOffset(0, 60, 400, 24), 0);
  assert.equal(focusScrollOffset(1, 60, 400, 24), 0);
});

test('focusScrollOffset guards degenerate inputs', () => {
  assert.equal(focusScrollOffset(-1, 60, 400, 24), 0);
  assert.equal(focusScrollOffset(3, 0, 400, 24), 0);
  assert.equal(focusScrollOffset(3, 60, 0, 24), 0);
});

test('nearestTimedIndex finds the previous timed line', () => {
  const lines: TimedLine[] = [
    { text: 'a', startMs: 0 },
    { text: 'b' },
    { text: 'c' },
    { text: 'd', startMs: 9000 },
  ];
  assert.equal(nearestTimedIndex(lines, 0), 0);
  assert.equal(nearestTimedIndex(lines, 2), 0);
  assert.equal(nearestTimedIndex(lines, 3), 3);
});

test('nearestTimedIndex returns -1 when nothing timed exists at or before', () => {
  const lines: TimedLine[] = [{ text: 'x' }, { text: 'y', startMs: 5000 }];
  assert.equal(nearestTimedIndex(lines, 0), -1);
  assert.equal(nearestTimedIndex(lines, 1), 1);
  assert.equal(nearestTimedIndex([], 0), -1);
});

test('nearestTimedIndex clamps out-of-range index to the last line', () => {
  assert.equal(nearestTimedIndex(synced, 99), 3);
});
