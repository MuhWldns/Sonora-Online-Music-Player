/**
 * Spotify-style animated lyrics: kinetic typography on a deep glass canvas.
 * The synced active line renders at display weight and full brightness;
 * neighbors dim back. Smooth scroll keeps the focused line centered, tap
 * focuses (and seeks, when timed), and a warm ambient glow breathes behind
 * the container. Fetching, caching, and retry live here so the player sheet
 * stays declarative.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { lyrics as fetchLyrics } from '../../api/client';
import type { Lyrics } from '../../api/types';
import { seekTo } from '../../player/service';
import { glass, radius, spacing, TOUCH_TARGET, typeScale } from '../../theme';
import type { Palette } from '../../theme';
import { activeLineIndex, focusScrollOffset, nearestTimedIndex } from './lyricsPosition';

/** Module-level lyrics cache: survives view switches inside a session. */
const lyricsCache = new Map<string, Lyrics | null>();

/** Platform timer handle for the manual-focus release timeout. */
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

/** Kinetic type roles (spec): active 26/800 full white, inactive 20/700 dim. */
const ACTIVE_SIZE = 26;
const INACTIVE_SIZE = 20;
/** Approximate rendered line pitch used for scroll-centering math. */
const LINE_PITCH = 44;
const CONTENT_TOP_PADDING = spacing.xxl;

export function AnimatedLyricsView({
  videoId,
  palette,
  currentTime,
  glowColor,
}: {
  videoId: string;
  palette: Palette;
  /** Playback position in seconds; drives synced-line focus. */
  currentTime: number;
  /** Ambient backlight tint; defaults to the signature amber glow. */
  glowColor?: string;
}) {
  const hasCached = lyricsCache.has(videoId);
  const [data, setData] = useState<Lyrics | null>(() => lyricsCache.get(videoId) ?? null);
  const [loading, setLoading] = useState(!hasCached);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  // Manual focus wins briefly after a tap, then playback focus resumes.
  const [manualFocus, setManualFocus] = useState<number | null>(null);
  const manualFocusTimer = useRef<TimerHandle | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const viewportH = useRef(0);
  const lastScrolledIndex = useRef(-2);

  // Ambient glow breathing loop (opacity only, native-driver safe).
  const glow = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.6,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  useEffect(() => {
    if (lyricsCache.has(videoId)) {
      setData(lyricsCache.get(videoId) ?? null);
      setLoading(false);
      setFailed(false);
      return;
    }

    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setFailed(false);
    fetchLyrics(videoId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        lyricsCache.set(videoId, response.lyrics);
        setData(response.lyrics);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
          return;
        setLoading(false);
        setFailed(true);
      });
    return () => controller.abort();
  }, [videoId, retry]);

  useEffect(
    () => () => {
      if (manualFocusTimer.current) clearTimeout(manualFocusTimer.current);
    },
    [],
  );

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const synced = !!data?.synced && lines.some((line) => line.startMs !== undefined);
  const playbackIndex = useMemo(
    () => (synced ? activeLineIndex(lines, currentTime * 1000) : -1),
    [synced, lines, currentTime],
  );
  const focusIndex = manualFocus ?? playbackIndex;

  // Smooth auto-centering: only scroll when the focused line actually changes.
  useEffect(() => {
    if (focusIndex < 0 || focusIndex === lastScrolledIndex.current) return;
    if (viewportH.current <= 0) return;
    lastScrolledIndex.current = focusIndex;
    scrollRef.current?.scrollTo({
      y: focusScrollOffset(focusIndex, LINE_PITCH, viewportH.current, CONTENT_TOP_PADDING),
      animated: true,
    });
  }, [focusIndex]);

  // Reset scroll bookkeeping per track.
  useEffect(() => {
    lastScrolledIndex.current = -2;
    setManualFocus(null);
  }, [videoId]);

  function focusLine(index: number): void {
    setManualFocus(index);
    if (manualFocusTimer.current) clearTimeout(manualFocusTimer.current);
    // Manual focus holds for a few seconds, then playback reclaims the focus.
    manualFocusTimer.current = setTimeout(() => setManualFocus(null), 5000);

    if (synced) {
      const timed = nearestTimedIndex(lines, index);
      const startMs = timed >= 0 ? lines[timed].startMs : undefined;
      if (startMs !== undefined) seekTo(startMs / 1000);
    }
    AccessibilityInfo.announceForAccessibility(lines[index]?.text ?? '');
  }

  if (loading) {
    return (
      <View style={styles.stateWrap} accessibilityLabel="Memuat lirik">
        <AmbientGlow color={glowColor ?? glass.glow} glow={glow} />
        <View style={styles.skeletonStack}>
          {[0.9, 0.6, 0.75, 0.5, 0.8].map((width, i) => (
            <View
              key={i}
              style={[
                styles.skeletonLine,
                { width: `${width * 100}%`, backgroundColor: glass.surfaceElevated },
              ]}
            />
          ))}
        </View>
        <ActivityIndicator color={palette.accent} style={styles.stateSpinner} />
        <Text style={[styles.stateText, { color: palette.textSecondary }]}>Memuat lirik…</Text>
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.stateWrap}>
        <AmbientGlow color={glowColor ?? glass.glow} glow={glow} />
        <Text style={[styles.stateText, { color: palette.error }]}>Lirik tidak dapat dimuat</Text>
        <Pressable
          onPress={() => setRetry((value) => value + 1)}
          accessibilityRole="button"
          accessibilityLabel="Coba muat lirik lagi"
          style={({ pressed }) => [
            styles.retryCapsule,
            {
              backgroundColor: pressed ? glass.pillActive : glass.pill,
              borderColor: glass.borderHighlight,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}
        >
          <Text style={[styles.retryText, { color: palette.accentText }]}>Coba lagi</Text>
        </Pressable>
      </View>
    );
  }

  if (!data || lines.length === 0) {
    return (
      <View style={styles.stateWrap}>
        <AmbientGlow color={glowColor ?? glass.glow} glow={glow} />
        <Text style={[styles.stateText, { color: palette.textSecondary }]}>
          Lirik belum tersedia untuk lagu ini
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <AmbientGlow color={glowColor ?? glass.glow} glow={glow} />
      <ScrollView
        ref={scrollRef}
        accessibilityLabel="Lirik lagu"
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {lines.map((line, index) => {
          const focused = focusIndex >= 0 && index === focusIndex;
          return (
            <Pressable
              key={`${index}-${line.text}`}
              onPress={() => focusLine(index)}
              accessibilityRole="button"
              accessibilityLabel={line.text || 'Baris kosong'}
              accessibilityHint={synced ? 'Lompat ke bagian lagu ini' : undefined}
              accessibilityState={{ selected: focused }}
              style={({ pressed }) => [
                styles.lineHit,
                pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Text
                style={[
                  styles.line,
                  {
                    color: palette.text,
                    fontSize: focused ? ACTIVE_SIZE : INACTIVE_SIZE,
                    fontWeight: focused ? '800' : '700',
                    lineHeight: focused ? 34 : 28,
                    opacity: focusIndex < 0 ? 0.85 : focused ? 1 : 0.35,
                    transform: [{ scale: focused ? 1.02 : 1 }],
                  },
                ]}
              >
                {line.text || ' '}
              </Text>
            </Pressable>
          );
        })}
        {data.source ? (
          <Text style={[styles.source, { color: palette.textSecondary }]}>{data.source}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Soft layered backlight circle behind the lyrics; breathes via opacity. */
function AmbientGlow({ color, glow }: { color: string; glow: Animated.Value }) {
  return (
    <View pointerEvents="none" style={styles.glowWrap}>
      <Animated.View
        style={[
          styles.glowCore,
          {
            backgroundColor: color,
            opacity: glow,
            transform: [{ scale: 1.15 }],
          },
        ]}
      />
      <Animated.View
        style={[styles.glowHalo, { backgroundColor: color, opacity: Animated.multiply(glow, 0.45) }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  glowWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCore: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    top: '32%',
  },
  glowHalo: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    top: '22%',
  },
  content: {
    paddingTop: CONTENT_TOP_PADDING,
    paddingBottom: spacing.xxl * 3,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  lineHit: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  line: {
    textAlign: 'left',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  source: { fontSize: typeScale.small, marginTop: spacing.lg },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  stateSpinner: { marginTop: spacing.md },
  stateText: { fontSize: typeScale.body, textAlign: 'center' },
  skeletonStack: {
    alignSelf: 'stretch',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  skeletonLine: { height: 22, borderRadius: radius.sm },
  retryCapsule: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  retryText: { fontSize: typeScale.body, fontWeight: '700' },
});
