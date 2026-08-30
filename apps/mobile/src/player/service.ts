/**
 * Playback service: react-native-track-player setup + queue management.
 *
 * Stream strategy (PoC result): /player returns a googlevideo URL bound to
 * the SERVER's IP — devices may get 403. /stream relays bytes through the
 * proxy and always matches. We play /stream directly; /player is kept for
 * future optimization (direct fetch when the URL works).
 */
import TrackPlayer, { Capability, Event } from 'react-native-track-player';

import { next, streamUrl } from '../api/client';
import type { ParsedItem, QueueItem } from '../api/types';

export async function setupPlayer(): Promise<void> {
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior:
        'StopPlaybackAndRemoveNotification' as never /* AppKilledPlaybackBehavior enum */,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause],
  });
}

function trackFromItem(item: ParsedItem) {
  return {
    id: item.videoId,
    url: streamUrl(item.videoId!),
    title: item.title,
    artist: item.artists?.map((a) => a.name).join(', ') || item.subtitle || '',
    artwork: item.thumbnail ?? undefined,
    duration: parseDurationToSeconds(item.duration),
  };
}

function trackFromQueueItem(item: QueueItem) {
  return {
    id: item.videoId,
    url: streamUrl(item.videoId),
    title: item.title,
    artist: item.artist,
    artwork: item.thumbnail ?? undefined,
    duration: parseDurationToSeconds(item.duration),
  };
}

/** "4:46" | "3:05:12" → seconds */
export function parseDurationToSeconds(d?: string): number | undefined {
  if (!d) return undefined;
  const parts = d.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Play a song immediately, seeding the queue with radio (up next). */
export async function playSong(item: ParsedItem): Promise<void> {
  if (!item.videoId) return;
  await TrackPlayer.reset();
  await TrackPlayer.add(trackFromItem(item));
  await TrackPlayer.play();

  // Seed radio queue in background; ignore failures (offline-tolerant)
  next(item.videoId)
    .then(async ({ queue }) => {
      const current = await TrackPlayer.getActiveTrackIndex();
      const rest = queue
        .filter((q) => !q.selected && q.videoId !== item.videoId)
        .map(trackFromQueueItem);
      if (rest.length) await TrackPlayer.add(rest, current !== undefined ? current + 1 : undefined);
    })
    .catch(() => {});
}

export async function playQueue(items: ParsedItem[], startIndex = 0): Promise<void> {
  const playable = items.filter((i) => i.videoId);
  if (!playable.length) return;
  await TrackPlayer.reset();
  await TrackPlayer.add(playable.map(trackFromItem));
  await TrackPlayer.skip(startIndex);
  await TrackPlayer.play();
}

/** Called from index.ts — handles auto-advance when queue runs out. */
export async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    // Queue seeded by playSong; if empty, nothing to do.
  });
}
