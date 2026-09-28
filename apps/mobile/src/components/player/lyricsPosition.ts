/**
 * Pure helpers for the animated lyrics view: synced-line focus math and
 * scroll target calculation. Kept RN-free so they run under node:test.
 */

export interface TimedLine {
  text: string;
  startMs?: number;
  endMs?: number;
}

export const LYRIC_LOOKAHEAD_MS = 200;

/**
 * Index of the line that owns `positionMs`: the last line whose startMs is
 * at or before the position. Lines without timing are skipped but still
 * occupy their slot, so the returned index matches the rendered array.
 * Returns -1 before the first timed line and for empty input.
 */
export function activeLineIndex(lines: readonly TimedLine[], positionMs: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].startMs;
    if (start === undefined) continue;
    if (positionMs >= start) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

export interface TimedLinePosition {
  current: number;
  total: number;
}

/** Ordinal among timed rows only; untimed spacer rows never inflate progress. */
export function timedLinePosition(
  lines: readonly TimedLine[],
  activeIndex: number,
): TimedLinePosition | null {
  let total = 0;
  let current = 0;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startMs === undefined) continue;
    total++;
    if (index <= activeIndex) current = total;
  }
  return total > 0 ? { current, total } : null;
}

/**
 * Compact player preview text. Synced lyrics follow playback; plain lyrics use
 * their first non-empty line because they have no timeline to follow.
 */
export function lyricPreviewText(
  lines: readonly TimedLine[],
  synced: boolean,
  positionMs: number,
): string {
  if (!synced) {
    for (const line of lines) {
      const text = line.text.trim();
      if (text) return text;
    }
    return '';
  }

  const index = activeLineIndex(lines, positionMs + LYRIC_LOOKAHEAD_MS);
  return index >= 0 ? lines[index].text.trim() : '';
}

/**
 * Vertical scroll offset that centers a measured row in the viewport.
 * Clamped to zero so rows near the content origin never scroll above it.
 */
export function focusScrollOffset(
  lineTop: number,
  lineHeight: number,
  viewportHeight: number,
): number {
  if (lineHeight <= 0 || viewportHeight <= 0) return 0;
  return Math.max(0, lineTop + lineHeight / 2 - viewportHeight / 2);
}

/**
 * Nearest timed line at or before `index`. Used when the user taps an
 * untimed line: focus and (if synced) seek anchor to the previous timed one.
 * Returns -1 when no timed line exists at or before `index`.
 */
export function nearestTimedIndex(lines: readonly TimedLine[], index: number): number {
  const bounded = Math.min(index, lines.length - 1);
  for (let i = bounded; i >= 0; i--) {
    if (lines[i].startMs !== undefined) return i;
  }
  return -1;
}
