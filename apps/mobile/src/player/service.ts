/** Native queue-backed playback service. Android owns playback, MediaSession,
 * queue advancement, and notification controls even while JS is backgrounded. */
import MediaControls from '../../modules/sonora-media-controls/src/SonoraMediaControlsModule';
import type {
  NativeTrack,
  PlaybackStatus,
} from '../../modules/sonora-media-controls/src/SonoraMediaControlsModule';

import { next, streamUrl } from '../api/client';
import type { ParsedItem, QueueItem } from '../api/types';

export interface PlayerTrack {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  durationSec?: number;
}

export interface PlayerState {
  queue: PlayerTrack[];
  index: number;
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
}

let state: PlayerState = {
  queue: [],
  index: -1,
  playing: false,
  buffering: false,
  currentTime: 0,
  duration: 0,
  error: null,
};

const listeners = new Set<() => void>();
let setupPromise: Promise<void> | null = null;
let queueGeneration = 0;
let lastStatus = 'no status events yet';

function emit(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function onStatus(status: PlaybackStatus): void {
  const track = state.queue[status.index];
  lastStatus =
    `index=${status.index} play=${status.playing} buf=${status.buffering}` +
    ` t=${status.currentTime.toFixed(1)} d=${status.duration.toFixed(1)}` +
    (status.error ? ` ERR=${status.error}` : '');
  emit({
    index: status.index,
    playing: status.playing,
    buffering: status.buffering,
    currentTime: status.currentTime,
    duration: status.duration > 0 ? status.duration : (track?.durationSec ?? 0),
    error: status.error ?? null,
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): PlayerState {
  return state;
}

export function getStatusDebug(): string {
  return lastStatus;
}

export async function setupPlayer(): Promise<void> {
  if (!setupPromise) {
    MediaControls.addListener('statusChanged', onStatus);
    setupPromise = MediaControls.setup().catch((error) => {
      setupPromise = null;
      throw error;
    });
  }
  await setupPromise;
}

function baseTrackDuration(track: PlayerTrack): number {
  return track.durationSec ?? 0;
}

async function nativeTrack(track: PlayerTrack): Promise<NativeTrack> {
  return {
    id: track.videoId,
    url: await streamUrl(track.videoId),
    title: track.title,
    artist: track.artist,
    artwork: track.thumbnail ?? undefined,
  };
}

async function replaceQueue(queue: PlayerTrack[], startIndex: number): Promise<void> {
  const generation = ++queueGeneration;
  emit({
    queue,
    index: startIndex,
    playing: false,
    buffering: true,
    currentTime: 0,
    duration: baseTrackDuration(queue[startIndex]),
    error: null,
  });

  try {
    await setupPlayer();
    const tracks = await Promise.all(queue.map(nativeTrack));
    if (generation !== queueGeneration) return;
    await MediaControls.replaceQueue(tracks, startIndex);
  } catch (error) {
    if (generation !== queueGeneration) return;
    emit({ playing: false, buffering: false, error: errorMessage(error) });
  }
}

export function togglePlay(): void {
  const operation = state.playing ? MediaControls.pause() : MediaControls.play();
  operation.catch((error) => emit({ error: errorMessage(error) }));
}

/** "4:46" | "3:05:12" → seconds */
export function parseDurationToSeconds(duration?: string): number | undefined {
  if (!duration) return undefined;
  const parts = duration.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

function trackFromItem(item: ParsedItem): PlayerTrack {
  return {
    videoId: item.videoId!,
    title: item.title,
    artist: item.artists?.map((artist) => artist.name).join(', ') || item.subtitle || '',
    thumbnail: item.thumbnail,
    durationSec: parseDurationToSeconds(item.duration),
  };
}

function trackFromQueueItem(item: QueueItem): PlayerTrack {
  return {
    videoId: item.videoId,
    title: item.title,
    artist: item.artist,
    thumbnail: item.thumbnail,
    durationSec: parseDurationToSeconds(item.duration),
  };
}

/** Play immediately, then extend the same native queue with radio results. */
export async function playSong(item: ParsedItem): Promise<void> {
  if (!item.videoId) return;
  const first = trackFromItem(item);
  await replaceQueue([first], 0);
  const generation = queueGeneration;

  try {
    const result = await next(item.videoId);
    if (generation !== queueGeneration) return;
    const existing = new Set(state.queue.map((track) => track.videoId));
    const rest = result.queue
      .filter((queued) => !queued.selected && !existing.has(queued.videoId))
      .map(trackFromQueueItem);
    if (!rest.length) return;

    const nativeTracks = await Promise.all(rest.map(nativeTrack));
    if (generation !== queueGeneration) return;
    emit({ queue: [...state.queue, ...rest] });
    await MediaControls.appendTracks(nativeTracks);
  } catch {
    // Radio seeding is optional; the selected track remains playable.
  }
}

export async function playQueue(items: ParsedItem[], startIndex = 0): Promise<void> {
  const playable = items.filter((item) => item.videoId).map(trackFromItem);
  if (!playable.length) return;
  await replaceQueue(playable, Math.max(0, Math.min(startIndex, playable.length - 1)));
}

export function playAt(index: number): void {
  if (index < 0 || index >= state.queue.length) return;
  MediaControls.skipTo(index).catch((error) => emit({ error: errorMessage(error) }));
}

export function nextTrack(): void {
  if (state.index + 1 >= state.queue.length) return;
  MediaControls.next().catch((error) => emit({ error: errorMessage(error) }));
}

export function prevTrack(): void {
  MediaControls.previous().catch((error) => emit({ error: errorMessage(error) }));
}

export function seekTo(seconds: number): void {
  const bounded = Math.max(0, Math.min(seconds, state.duration || seconds));
  MediaControls.seekTo(bounded).catch((error) => emit({ error: errorMessage(error) }));
  emit({ currentTime: bounded });
}
