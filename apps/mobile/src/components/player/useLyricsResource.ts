import { useCallback, useEffect, useState } from 'react';

import { lyrics as fetchLyrics } from '../../api/client';
import type { Lyrics } from '../../api/types';

interface LyricsLoadState {
  videoId: string | undefined;
  lyrics: Lyrics | null;
  loading: boolean;
  failed: boolean;
}

export interface LyricsResource {
  lyrics: Lyrics | null;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

/** Session cache shared by the compact preview and full lyrics surface. */
const lyricsCache = new Map<string, Lyrics | null>();

function cachedState(videoId: string | undefined): LyricsLoadState {
  if (!videoId) return { videoId, lyrics: null, loading: false, failed: false };
  if (!lyricsCache.has(videoId)) {
    return { videoId, lyrics: null, loading: true, failed: false };
  }
  return {
    videoId,
    lyrics: lyricsCache.get(videoId) ?? null,
    loading: false,
    failed: false,
  };
}

export function useLyricsResource(videoId: string | undefined): LyricsResource {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LyricsLoadState>(() => cachedState(videoId));

  useEffect(() => {
    if (!videoId || lyricsCache.has(videoId)) {
      setState(cachedState(videoId));
      return;
    }

    const controller = new AbortController();
    setState({ videoId, lyrics: null, loading: true, failed: false });
    fetchLyrics(videoId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        lyricsCache.set(videoId, response.lyrics);
        setState({ videoId, lyrics: response.lyrics, loading: false, failed: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return;
        }
        setState({ videoId, lyrics: null, loading: false, failed: true });
      });

    return () => controller.abort();
  }, [videoId, attempt]);

  const retry = useCallback(() => {
    if (videoId) setAttempt((value) => value + 1);
  }, [videoId]);

  const current = state.videoId === videoId ? state : cachedState(videoId);
  return {
    lyrics: current.lyrics,
    loading: current.loading,
    failed: current.failed,
    retry,
  };
}
