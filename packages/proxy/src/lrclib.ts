import type { LyricsLine, ParsedLyrics } from './parsers.js';

const LRCLIB_ENDPOINT = 'https://lrclib.net/api/get';
const LRCLIB_CLIENT =
  'Sonora-Music-Lyrics/1.0 (https://github.com/MuhWldns/Sonora-Online-Music-Player)';
const LRCLIB_TIMEOUT_MS = 4_000;
const MAX_DURATION_SEC = 3_600;
const MAX_TIMESTAMP_MS = MAX_DURATION_SEC * 1_000;

export interface LrclibTrackSignature {
  title: string;
  artist: string;
  durationSec: number;
}

export type LrclibLookupResult =
  | { kind: 'found'; lyrics: ParsedLyrics }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; retryAfterSec?: number };

interface LrclibRecord {
  instrumental: boolean;
  duration: number;
  syncedLyrics: string | null;
}

export function normalizeLrclibSignature(
  signature: LrclibTrackSignature,
): LrclibTrackSignature {
  return {
    title: signature.title.trim().replace(/\s+/gu, ' '),
    artist: signature.artist.trim().replace(/\s+/gu, ' '),
    durationSec: signature.durationSec,
  };
}

export function parseDurationSeconds(value: string): number | undefined {
  const twoPart = /^(\d+):(\d{2})$/.exec(value);
  const threePart = /^(\d+):(\d{2}):(\d{2})$/.exec(value);

  let total: number;
  if (twoPart) {
    const minutes = Number(twoPart[1]);
    const seconds = Number(twoPart[2]);
    if (!Number.isSafeInteger(minutes) || seconds > 59) return undefined;
    total = minutes * 60 + seconds;
  } else if (threePart) {
    const hours = Number(threePart[1]);
    const minutes = Number(threePart[2]);
    const seconds = Number(threePart[3]);
    if (!Number.isSafeInteger(hours) || minutes > 59 || seconds > 59) return undefined;
    total = hours * 3_600 + minutes * 60 + seconds;
  } else {
    return undefined;
  }

  return Number.isSafeInteger(total) && total >= 1 && total <= MAX_DURATION_SEC
    ? total
    : undefined;
}

export function parseSyncedLyrics(value: string): LyricsLine[] {
  const entries: { line: LyricsLine & { startMs: number }; order: number }[] = [];
  const lines = value.replace(/\r\n?/g, '\n').split('\n');

  for (let order = 0; order < lines.length; order++) {
    const match = /^\[(\d+):(\d{2})(?:\.(\d{1,3}))?\](.*)$/.exec(lines[order]);
    if (!match) continue;

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isSafeInteger(minutes) || seconds > 59) continue;

    const fraction = match[3] ?? '';
    const fractionMs = fraction ? Number(fraction.padEnd(3, '0')) : 0;
    const startMs = (minutes * 60 + seconds) * 1_000 + fractionMs;
    if (!Number.isSafeInteger(startMs) || startMs > MAX_TIMESTAMP_MS) continue;

    entries.push({
      line: { text: match[4].trim(), startMs },
      order,
    });
  }

  entries.sort((a, b) => a.line.startMs - b.line.startMs || a.order - b.order);

  for (let groupStart = 0; groupStart < entries.length; ) {
    let nextGroup = groupStart + 1;
    while (
      nextGroup < entries.length &&
      entries[nextGroup].line.startMs === entries[groupStart].line.startMs
    ) {
      nextGroup++;
    }
    const endMs = entries[nextGroup]?.line.startMs;
    if (endMs !== undefined) {
      for (let index = groupStart; index < nextGroup; index++) {
        entries[index].line.endMs = endMs;
      }
    }
    groupStart = nextGroup;
  }

  return entries.map(({ line }) => line);
}

function isLrclibRecord(value: unknown): value is LrclibRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.instrumental === 'boolean' &&
    typeof record.duration === 'number' &&
    Number.isFinite(record.duration) &&
    (typeof record.syncedLyrics === 'string' || record.syncedLyrics === null)
  );
}

function retryAfterSeconds(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 60;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 60;
}

export async function fetchExactLrclibLyrics(
  fetchImpl: typeof globalThis.fetch,
  signature: LrclibTrackSignature,
): Promise<LrclibLookupResult> {
  if (
    !Number.isInteger(signature.durationSec) ||
    signature.durationSec < 1 ||
    signature.durationSec > MAX_DURATION_SEC
  ) {
    return { kind: 'unavailable' };
  }

  const url = new URL(LRCLIB_ENDPOINT);
  url.searchParams.set('track_name', signature.title);
  url.searchParams.set('artist_name', signature.artist);
  url.searchParams.set('duration', String(signature.durationSec));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LRCLIB_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: { 'Lrclib-Client': LRCLIB_CLIENT },
      signal: controller.signal,
    });

    if (response.status === 404) return { kind: 'not-found' };
    if (response.status === 429) {
      return {
        kind: 'unavailable',
        retryAfterSec: retryAfterSeconds(response.headers.get('retry-after')),
      };
    }
    if (!response.ok) return { kind: 'unavailable' };

    const payload: unknown = await response.json();
    if (!isLrclibRecord(payload)) return { kind: 'unavailable' };
    if (payload.instrumental) return { kind: 'not-found' };
    if (Math.abs(payload.duration - signature.durationSec) > 2) {
      return { kind: 'not-found' };
    }

    const lines = payload.syncedLyrics ? parseSyncedLyrics(payload.syncedLyrics) : [];
    if (!lines.length) return { kind: 'not-found' };

    return {
      kind: 'found',
      lyrics: {
        lines,
        synced: true,
        source: 'Lyrics provided by LRCLIB',
      },
    };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
