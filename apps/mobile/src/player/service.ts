 /** Native queue-backed playback service. Android owns playback, MediaSession,
 * queue advancement, and notification controls even while JS is backgrounded. */
import MediaControls from '../../modules/sonora-media-controls/src/SonoraMediaControlsModule';
import type {
  NativeTrack,
  PlaybackStatus,
} from '../../modules/sonora-media-controls/src/SonoraMediaControlsModule';

import { next, nextContinue as nextContinueApi, streamUrl } from '../api/client';
import type { ParsedItem, QueueItem } from '../api/types';
import { recordPlayed } from '../storage/recentlyPlayed';

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
  shuffle: boolean;
  error: string | null;
}

let state: PlayerState = {
  queue: [],
  index: -1,
  playing: false,
  buffering: false,
  currentTime: 0,
  duration: 0,
  shuffle: false,
  error: null,
};

const listeners = new Set<() => void>();
let setupPromise: Promise<void> | null = null;
let queueGeneration = 0;
let lastStatus = 'no status events yet';
let lastRecordedVideoId: string | null = null;

/** Continuation paging for /next. Each call to /next seeds the queue and
 *  stashes a token; /next/continue pages the same automix past the first
 *  ~25 items. A new /next (playSong) replaces the token with a fresh seed.
 *
 *  The throttle prevents spam when the user advances quickly through a
 *  short tail. MIN_CONTINUE_INTERVAL_MS matches the cadence YTM client
 *  uses internally; tight enough to refill, loose enough to avoid the
 *  continuation endpoint rejecting rapid requests. */
const MIN_CONTINUE_INTERVAL_MS = 4000;
const CONTINUE_THRESHOLD = 5;
const MAX_QUEUE = 100;
let nextContinuationToken: string | null = null;
let lastNextContinueAt = 0;

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
    shuffle: status.shuffle,
    error: status.error ?? null,
  });

  // Record the track as recently-played the first time the native player
  // reports `playing` for it. Skips buffering/error/initial-prep states and
  // skips duplicate events for the same track (e.g. pause/resume, scrub).
  if (
    status.playing &&
    !status.buffering &&
    !status.error &&
    track &&
    track.videoId !== lastRecordedVideoId
  ) {
    lastRecordedVideoId = track.videoId;
    void recordPlayed({
      videoId: track.videoId,
      title: track.title,
      artist: track.artist,
      thumbnail: track.thumbnail,
      playedAt: Date.now(),
    });
  }

  // Auto-page the automix when the upcoming tail runs low. The trigger is
  // the residual queue AFTER the current track, not the raw queue length;
  // we only care how many tracks remain until the user runs out. We use the
  // post-emit state so the threshold reflects what listeners see.
  if (
    state.queue.length > 0 &&
    state.index >= 0 &&
    state.queue.length - state.index - 1 <= CONTINUE_THRESHOLD &&
    nextContinuationToken !== null
  ) {
    void nextContinue();
  }
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

/** All queue mutations run one at a time. Without this, playSong's radio seed
 * and an addToQueue insert can interleave, leaving JS state.queue and the
 * native Media3 queue in different orders.
 *
 * INVARIANT: an op must never await another serializeMutation call — the inner
 * op would queue behind the outer one and wait forever. */
let mutationChain: Promise<unknown> = Promise.resolve();

function serializeMutation<T>(op: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(op, op);
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function replaceQueue(queue: PlayerTrack[], startIndex: number): Promise<void> {
  const generation = ++queueGeneration;
  // Optimistic emit so the player reflects the new track immediately.
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
    await serializeMutation(async () => {
      if (generation !== queueGeneration) return;
      // JS and native mutate inside ONE serialized slot. Emitting outside it
      // let a queued insert land between the emit and the native call, which
      // left state.queue and the Media3 queue permanently different.
      emit({ queue, index: startIndex, buffering: true, currentTime: 0 });
      await MediaControls.replaceQueue(tracks, startIndex);
    });
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

    const candidates = result.queue
      .filter((queued) => !queued.selected)
      .map(trackFromQueueItem);
    const resolved = await Promise.all(candidates.map(nativeTrack));
    if (generation !== queueGeneration) return;

    // Dedupe, JS emit, and the native append all happen in ONE serialized
    // slot. Recomputing the snapshot here (not before) means a concurrent
    // addToQueue that already inserted a track cannot be duplicated.
    await serializeMutation(async () => {
      if (generation !== queueGeneration) return;
      const existing = new Set(state.queue.map((track) => track.videoId));
      const freshTracks: PlayerTrack[] = [];
      const freshNative: NativeTrack[] = [];
      candidates.forEach((track, i) => {
        if (existing.has(track.videoId)) return;
        existing.add(track.videoId);
        freshTracks.push(track);
        freshNative.push(resolved[i]);
      });
      if (!freshTracks.length) return;

      emit({ queue: [...state.queue, ...freshTracks] });
      await MediaControls.appendTracks(freshNative);
    });
    // Stash the continuation token so onStatus can page more tracks when
    // the tail runs low. A new playSong replaces this with the new seed's
    // token; never both at once because playSong awaits replaceQueue first
    // (queueGeneration bump) before /next fires.
    if (generation === queueGeneration) {
      nextContinuationToken = result.continuation ?? null;
      lastNextContinueAt = Date.now();
    }
  } catch {
    // Radio seeding is optional; the selected track remains playable.
  }
}

/** Page the current automix past its tail using the stashed continuation
 *  token. Throttled, capped, dedup'd — same shape as the radio-seed append
 *  in playSong but keyed on the cached token instead of a fresh /next.
 *
 *  No-ops (silently) when: no token, queue already at cap, throttle window
 *  not yet elapsed, or a queue mutation is in flight (serializeMutation
 *  guarantees serialization regardless). */
export async function nextContinue(): Promise<void> {
  if (!nextContinuationToken) return;
  if (Date.now() - lastNextContinueAt < MIN_CONTINUE_INTERVAL_MS) return;
  if (state.queue.length >= MAX_QUEUE) return;

  const token = nextContinuationToken;
  const generation = queueGeneration;
  lastNextContinueAt = Date.now();

  try {
    const result = await nextContinueApi(token);
    if (generation !== queueGeneration) return;

    const candidates = result.queue
      .filter((queued) => !queued.selected)
      .map(trackFromQueueItem);
    if (!candidates.length) return;

    const resolved = await Promise.all(candidates.map(nativeTrack));
    if (generation !== queueGeneration) return;

    await serializeMutation(async () => {
      if (generation !== queueGeneration) return;
      const existing = new Set(state.queue.map((track) => track.videoId));
      const freshTracks: PlayerTrack[] = [];
      const freshNative: NativeTrack[] = [];
      const slotsLeft = MAX_QUEUE - state.queue.length;
      candidates.forEach((track, i) => {
        if (existing.has(track.videoId)) return;
        existing.add(track.videoId);
        if (freshTracks.length >= slotsLeft) return; // honor hard cap
        freshTracks.push(track);
        freshNative.push(resolved[i]);
      });
      if (!freshTracks.length) return;

      emit({ queue: [...state.queue, ...freshTracks] });
      await MediaControls.appendTracks(freshNative);
    });
    // YTM continuation tokens are single-use; once consumed, drop it so
    // we don't re-fire the same page. A future /next (new seed) replaces it.
    if (generation === queueGeneration) nextContinuationToken = null;
  } catch {
    // Auto-paging is best-effort; queue keeps playing what it has.
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
  // Under shuffle the native order is not the JS array order, so the
  // "last item" guard would wrongly block a valid next.
  if (!state.shuffle && state.index + 1 >= state.queue.length) return;
  MediaControls.next().catch((error) => emit({ error: errorMessage(error) }));
}

export function prevTrack(): void {
  MediaControls.previous().catch((error) => emit({ error: errorMessage(error) }));
}

/** Flip shuffle on the native player. The native status event is the single
 * source of truth, so we do not emit optimistically: an optimistic value can
 * fight a newer status event and show the wrong state. */
export function toggleShuffle(): void {
  MediaControls.setShuffle(!state.shuffle).catch((error) =>
    emit({ error: errorMessage(error) }),
  );
}

/** Insert tracks into the live queue. 'next' lands right after the current
 * track; 'end' appends. Skips tracks already queued to avoid duplicates. */
export async function addToQueue(
  items: ParsedItem[],
  placement: 'next' | 'end' = 'end',
): Promise<void> {
  const tracks = items.filter((item) => item.videoId).map(trackFromItem);
  if (!tracks.length) return;

  // Nothing loaded yet: seed playback so the action is not a silent no-op.
  if (!state.queue.length) {
    await replaceQueue(tracks, 0);
    return;
  }

  const existing = new Set(state.queue.map((track) => track.videoId));
  const fresh = tracks.filter((track) => !existing.has(track.videoId));
  if (!fresh.length) return;

  const generation = queueGeneration;
  try {
    await setupPlayer();
    const nativeTracks = await Promise.all(fresh.map(nativeTrack));
    // Everything below runs in one serialized slot: re-filter, insert natively,
    // then mirror the result in JS. The index is read here so it matches the
    // queue as it exists when the native insert actually runs.
    await serializeMutation(async () => {
      if (generation !== queueGeneration) return;
      const queued = new Set(state.queue.map((track) => track.videoId));
      const pending: PlayerTrack[] = [];
      const nativePending: NativeTrack[] = [];
      fresh.forEach((track, i) => {
        if (queued.has(track.videoId)) return;
        queued.add(track.videoId);
        pending.push(track);
        nativePending.push(nativeTracks[i]);
      });
      if (!pending.length) return;

      // "Play next" resolves its position from the LIVE native current item and
      // returns the index used, so a stale JS index (backgrounded auto-advance)
      // cannot land the insert in the wrong slot. "Add to end" truly appends.
      let insertAt: number;
      if (placement === 'next') {
        insertAt = await MediaControls.insertTracksAfterCurrent(nativePending);
      } else {
        insertAt = state.queue.length;
        await MediaControls.appendTracks(nativePending);
      }
      // No generation re-check here: the native insert already happened, so
      // skipping the JS emit would leave the two queues out of sync.
      const nextQueue = [...state.queue];
      nextQueue.splice(Math.min(insertAt, nextQueue.length), 0, ...pending);
      emit({ queue: nextQueue });
    });
  } catch (error) {
    if (generation !== queueGeneration) return;
    emit({ error: errorMessage(error) });
  }
}

/** Convenience for row actions: matches the SongRow onAddToQueue signature. */
export function addItemToQueue(item: ParsedItem, placement: 'next' | 'end'): void {
  addToQueue([item], placement).catch(() => {});
}

/** Editable region = every absolute index AFTER the current track. The current
 * track is pinned: it never moves and never disappears, so state.index stays
 * stable across reorder/removal and JS stays trivially aligned with the native
 * Media3 timeline. Indices are absolute positions in state.queue. */
function isEditableIndex(index: number): boolean {
  return index > state.index && index < state.queue.length;
}

/** Move one upcoming track to another upcoming position (Media3 semantics:
 * `toIndex` is the destination AFTER the item is lifted out). The native op
 * runs first inside the serialized slot and JS mirrors the exact same move only
 * once it resolves, so a rejected native call leaves both queues untouched.
 * Returns whether the move was actually applied, letting the sheet snap back. */
export async function moveQueueItem(fromIndex: number, toIndex: number): Promise<boolean> {
  if (fromIndex === toIndex) return false;
  if (!isEditableIndex(fromIndex) || !isEditableIndex(toIndex)) return false;

  const generation = queueGeneration;
  try {
    await setupPlayer();
    let applied = false;
    await serializeMutation(async () => {
      if (generation !== queueGeneration) return;
      // Re-validate against the queue as it exists when the op actually runs.
      if (fromIndex === toIndex) return;
      if (!isEditableIndex(fromIndex) || !isEditableIndex(toIndex)) return;
      await MediaControls.moveMediaItem(fromIndex, toIndex);
      const nextQueue = [...state.queue];
      const [moved] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, moved);
      emit({ queue: nextQueue });
      applied = true;
    });
    return applied;
  } catch (error) {
    if (generation !== queueGeneration) return false;
    emit({ error: errorMessage(error) });
    return false;
  }
}

/** Remove one upcoming track. The current track is never removable: this guard
 * and the native module both reject it. Works while shuffle is on because
 * Media3 keeps its shuffle order coherent across a removal. Returns whether the
 * removal was applied so the swipe affordance can recover on failure. */
export async function removeQueueItem(index: number): Promise<boolean> {
  if (!isEditableIndex(index)) return false;

  const generation = queueGeneration;
  try {
    await setupPlayer();
    let applied = false;
    await serializeMutation(async () => {
      if (generation !== queueGeneration) return;
      if (!isEditableIndex(index)) return;
      await MediaControls.removeMediaItem(index);
      const nextQueue = [...state.queue];
      nextQueue.splice(index, 1);
      emit({ queue: nextQueue });
      applied = true;
    });
    return applied;
  } catch (error) {
    if (generation !== queueGeneration) return false;
    emit({ error: errorMessage(error) });
    return false;
  }
}

export function seekTo(seconds: number): void {
  const bounded = Math.max(0, Math.min(seconds, state.duration || seconds));
  MediaControls.seekTo(bounded).catch((error) => emit({ error: errorMessage(error) }));
  emit({ currentTime: bounded });
}
