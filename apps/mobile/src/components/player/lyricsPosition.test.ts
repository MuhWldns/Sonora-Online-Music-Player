import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeLineIndex,
  focusScrollOffset,
  lyricPreviewText,
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

test('lyricPreviewText follows synced playback with the shared lookahead', () => {
  assert.equal(lyricPreviewText(synced, true, -201), '');
  assert.equal(lyricPreviewText(synced, true, -200), 'line one');
  assert.equal(lyricPreviewText(synced, true, 3799), 'line one');
  assert.equal(lyricPreviewText(synced, true, 3800), 'line two');
});

test('lyricPreviewText keeps instrumental rows blank', () => {
  const instrumental: TimedLine[] = [
    { text: 'sung', startMs: 0 },
    { text: '', startMs: 2000 },
    { text: 'next', startMs: 4000 },
  ];
  assert.equal(lyricPreviewText(instrumental, true, 2200), '');
});

test('lyricPreviewText uses the first non-empty plain lyric', () => {
  const plain: TimedLine[] = [{ text: '' }, { text: ' first line ' }, { text: 'second' }];
  assert.equal(lyricPreviewText(plain, false, 9000), 'first line');
  assert.equal(lyricPreviewText([], false, 9000), '');
});

test('focusScrollOffset centers measured rows in the viewport', () => {
  assert.equal(focusScrollOffset(300, 48, 400), 124);
  assert.equal(focusScrollOffset(640, 48, 400), 464);
});

test('focusScrollOffset centers a wrapped tall row using its actual height', () => {
  assert.equal(focusScrollOffset(420, 102, 360), 291);
});

test('focusScrollOffset clamps rows near the content origin', () => {
  assert.equal(focusScrollOffset(0, 48, 400), 0);
  assert.equal(focusScrollOffset(120, 48, 400), 0);
});

test('focusScrollOffset guards non-positive dimensions', () => {
  assert.equal(focusScrollOffset(300, 0, 400), 0);
  assert.equal(focusScrollOffset(300, -1, 400), 0);
  assert.equal(focusScrollOffset(300, 48, 0), 0);
  assert.equal(focusScrollOffset(300, 48, -1), 0);
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
