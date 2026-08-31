/**
 * Playback service: expo-audio player + JS-side queue management.
 *
 * Stream strategy (PoC result): /player returns a googlevideo URL bound to
 * the SERVER's IP — devices may get 403. /stream relays bytes through the
 * proxy and always matches. We play /stream directly; /player is kept for
 * future optimization (direct fetch when the URL works).
 *
 * Engine note: react-native-track-player v4 (old-arch) is unsupported on
 * Expo SDK 57's new-arch-only runtime; v5 went commercial. expo-audio is
 * first-party: one AudioPlayer + this module owns the queue. Lockscreen
 * controls via setActiveForLockScreen keep Android background playback alive.
 */
import { createAudioPlayer, setAudioModeAsync, requestNotificationPermissionsAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';

import { next, streamUrl } from '../api/client';
import type { ParsedItem, QueueItem } from '../api/types';
import { stopAndReleasePlayer } from './lifecycle';

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

function emit(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): PlayerState {
  return state;
}

let player: AudioPlayer | null = null;
let isSetup = false;
let advancing = false; // dedupe didJustFinish firing more than once per track

export async function setupPlayer(): Promise<void> {
  if (isSetup) return;
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    // 'mixWithOthers': skip audio-focus request entirely. Native expo-audio
    // with 'doNotMix' requests AUDIOFOCUS_GAIN_TRANSIENT — MIUI/HyperOS can
    // revoke transient focus immediately (player paused right after play).
    interruptionMode: 'mixWithOthers',
  });
  // Android 13+ needs POST_NOTIFICATIONS for the media notification.
  requestNotificationPermissionsAsync().catch(() => {});
  isSetup = true;
}

let statusCount = 0;
let lastStatusStr = '';
let lastUri = '';
let lastReplaceErr = '';
function onStatus(s: AudioStatus): void {
  const track = state.queue[state.index];
  statusCount++;
  let pbState = '?';
  if ('playbackState' in s && typeof s.playbackState === 'string') pbState = s.playbackState;
  let reason: string | null = null;
  if ('reasonForWaitingToPlay' in s) {
    const r = s.reasonForWaitingToPlay;
    if (typeof r === 'string') reason = r;
  }
  lastStatusStr =
    `#${statusCount} state=${pbState} load=${s.isLoaded} play=${s.playing} buf=${s.isBuffering}` +
    ` t=${s.currentTime.toFixed(1)} d=${s.duration.toFixed(1)} rate=${s.playbackRate}` +
    (reason ? ` wait=${reason}` : '') +
    (s.error ? ` ERR=${s.error}` : '') +
    (lastReplaceErr ? ` LOAD_ERR=${lastReplaceErr}` : '');
  emit({
    playing: s.playing,
    buffering: s.isBuffering,
    currentTime: s.currentTime,
    duration: s.duration > 0 ? s.duration : (track?.durationSec ?? 0),
    error: s.error ?? lastReplaceErr ?? null,
  });
  // Source finished loading after replace(): this is the reliable moment to
  // start playback — calling play() synchronously after replace() races the
  // loader and can be dropped on Android.
  // Gate auto-play saat source siap. Guard `currentTime===0` dihapus: expo-audio
  // di new-arch kadang emit event pertama dengan currentTime>0 (preroll decode),
  // menyebabkan cabang play() tidak pernah masuk → UI diam tanpa error.
  // `wantPlay` di-consume agar tidak re-trigger di status berikutnya.
  if (s.isLoaded && wantPlay && !s.playing && !s.didJustFinish) {
    wantPlay = false;
    player?.play();
  }
  if (s.didJustFinish && !advancing) {
    advancing = true;
    advance();
  } else if (!s.didJustFinish) {
    advancing = false;
  }
}

export function getStatusDebug(): string {
  const base = lastStatusStr || 'no status events yet';
  return `${base}\nuri=${lastUri || '(none)'}`;
}

let wantPlay = false; // set by startTrack; consumed by onStatus when loaded

function startTrack(i: number): void {
  const track = state.queue[i];
  if (!track || !isSetup) return;
  wantPlay = true;
  emit({
    index: i,
    currentTime: 0,
    duration: track.durationSec ?? 0,
    error: null,
    buffering: true,
  });
  lastReplaceErr = '';
  // expo-audio Android 57 bug: createAudioPlayer(null) + replace() nanti
  // membuat ExoPlayer stuck di STATE_IDLE karena AudioModule.replace() digated
  // oleh `availableCommands.contains(COMMAND_CHANGE_MEDIA_ITEMS)` yang belum
  // populate sampai setMediaSource pertama dijalankan. Fix: setiap track buat
  // player baru dengan source non-null di Constructor → init block native
  // langsung panggil setMediaSource + prepare().
  streamUrl(track.videoId)
    .then((uri) => {
      lastUri = uri;
      if (state.queue[state.index] !== track) return; // user skipped ahead
      // Release previous player: remove() drop dari native players map,
      // dereference JS → sharedObjectDidRelease fire, listener unlink, ref.release().
      const prev = player;
      if (prev) {
        player = null;
        try { stopAndReleasePlayer(prev); } catch { /* ignore double-release */ }
      }
      try {
        const next = createAudioPlayer({ uri, name: track.title });
        next.volume = 1;
        next.addListener('playbackStatusUpdate', onStatus);
        next.setActiveForLockScreen(true, {
          title: track.title,
          artist: track.artist,
          artworkUrl: track.thumbnail ?? undefined,
        });
        player = next;
      } catch (e) {
        lastReplaceErr = e instanceof Error ? e.message : String(e);
        emit({ error: lastReplaceErr, buffering: false });
      }
    })
    .catch((e) => {
      lastReplaceErr = e instanceof Error ? e.message : String(e);
      emit({ error: lastReplaceErr, buffering: false });
    });
}

export function togglePlay(): void {
  if (!player) return;
  if (state.playing) {
    wantPlay = false;
    player.pause();
  } else {
    wantPlay = true;
    player.play();
  }
}

function baseTrackDuration(track: PlayerTrack): number {
  return track.durationSec ?? 0;
}

function advance(): void {
  if (state.index + 1 < state.queue.length) startTrack(state.index + 1);
  else emit({ playing: false });
}

/** "4:46" | "3:05:12" → seconds */
export function parseDurationToSeconds(d?: string): number | undefined {
  if (!d) return undefined;
  const parts = d.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function trackFromItem(item: ParsedItem): PlayerTrack {
  return {
    videoId: item.videoId!,
    title: item.title,
    artist: item.artists?.map((a) => a.name).join(', ') || item.subtitle || '',
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

/** Play a song immediately, seeding the queue with radio (up next). */
export async function playSong(item: ParsedItem): Promise<void> {
  if (!item.videoId) return;
  emit({ queue: [trackFromItem(item)] });
  startTrack(0);

  // Seed radio queue in background; ignore failures (offline-tolerant)
  next(item.videoId)
    .then(({ queue }) => {
      const existing = new Set(state.queue.map((t) => t.videoId));
      const rest = queue
        .filter((q) => !q.selected && !existing.has(q.videoId))
        .map(trackFromQueueItem);
      if (rest.length) emit({ queue: [...state.queue, ...rest] });
    })
    .catch(() => {});
}

export async function playQueue(items: ParsedItem[], startIndex = 0): Promise<void> {
  const playable = items.filter((i) => i.videoId).map(trackFromItem);
  if (!playable.length) return;
  emit({ queue: playable });
  startTrack(startIndex);
}

/** Jump to a queue position (from queue sheet). */
export function playAt(index: number): void {
  if (index >= 0 && index < state.queue.length) startTrack(index);
}


export function nextTrack(): void {
  if (state.index + 1 < state.queue.length) startTrack(state.index + 1);
}

export function prevTrack(): void {
  // Canon behavior: restart current track if past 3s, else go back.
  if (state.currentTime > 3) {
    seekTo(0);
    return;
  }
  if (state.index > 0) startTrack(state.index - 1);
}

export function seekTo(seconds: number): void {
  player?.seekTo(Math.max(0, Math.min(seconds, state.duration || seconds)));
  emit({ currentTime: seconds });
}
