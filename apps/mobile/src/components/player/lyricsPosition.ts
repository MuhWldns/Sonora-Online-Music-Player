/**
 * Pure helpers for the animated lyrics view: synced-line focus math and
 * scroll target calculation. Kept RN-free so they run under node:test.
 */

export interface TimedLine {
  text: string;
  startMs?: number;
  endMs?: number;
}

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

/**
 * Vertical scroll offset that centers line `index` in the viewport, given a
 * fixed line pitch (row height incl. gap) and the top padding of the content.
 * Clamped to zero so the first lines never pull above the content origin.
 */
export function focusScrollOffset(
  index: number,
  linePitch: number,
  viewportHeight: number,
  topPadding: number,
): number {
  if (index < 0 || linePitch <= 0 || viewportHeight <= 0) return 0;
  const lineCenter = topPadding + index * linePitch + linePitch / 2;
  return Math.max(0, lineCenter - viewportHeight / 2);
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
