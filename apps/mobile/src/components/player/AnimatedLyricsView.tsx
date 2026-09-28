/**
 * Spotify-style animated lyrics: kinetic typography on a deep glass canvas.
 * Each line owns Animated.Values for opacity and scale — driven by native
 * driver so transitions run at 60 fps without touching the JS thread.
 *
 * States per line:
 *   active  (being sung)  → opacity 1.0, scale 1.05, size 26/800
 *   past    (already sung) → opacity 0.25, scale 1.0,  size 20/700
 *   future  (not yet)      → opacity 0.45, scale 1.0,  size 20/700
 *   no sync                → opacity 0.85 all,         size 20/700
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  type LayoutChangeEvent,
} from 'react-native';

import type { LyricsLine } from '../../api/types';
import { seekTo } from '../../player/service';
import { glass, radius, spacing, TOUCH_TARGET, typeScale } from '../../theme';
import type { Palette } from '../../theme';
import {
  activeLineIndex,
  focusScrollOffset,
  LYRIC_LOOKAHEAD_MS,
  nearestTimedIndex,
  timedLinePosition,
} from './lyricsPosition';
import type { LyricsResource } from './useLyricsResource';
/** Kinetic type roles (spec): active 26/800 full white, inactive 20/700 dim. */
const ACTIVE_SIZE = 26;
const INACTIVE_SIZE = 20;

/** Durations for opacity transitions in ms. */
const FADE_IN_MS = 180;
const FADE_OUT_MS = 320;

// ─── Per-line animated row ──────────────────────────────────────────────────

interface LyricRowProps {
  line: LyricsLine;
  index: number;
  state: 'active' | 'past' | 'future' | 'unsync';
  palette: Palette;
  synced: boolean;
  reduceMotion: boolean;
  onPress: (index: number) => void;
  onRowLayout: (index: number, y: number, height: number) => void;
}

interface RowGeometry {
  y: number;
  height: number;
}

const TARGET_OPACITY: Record<LyricRowProps['state'], number> = {
  active: 1.0,
  past: 0.25,
  future: 0.45,
  unsync: 0.85,
};
const TARGET_SCALE: Record<LyricRowProps['state'], number> = {
  active: 1.05,
  past: 1.0,
  future: 1.0,
  unsync: 1.0,
};

const LyricRow = memo(function LyricRow({
  line,
  index,
  state,
  palette,
  synced,
  reduceMotion,
  onPress,
  onRowLayout,
}: LyricRowProps) {
  const opacity = useRef(new Animated.Value(TARGET_OPACITY[state])).current;
  const scale = useRef(new Animated.Value(TARGET_SCALE[state])).current;
  const focus = useRef(new Animated.Value(state === 'active' ? 1 : 0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const prevState = useRef(state);
  const focusTranslateX = useMemo(
    () => focus.interpolate({ inputRange: [0, 1], outputRange: [0, spacing.lg] }),
    [focus],
  );
  const markerScaleX = useMemo(
    () => focus.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    [focus],
  );
  const ripple = useMemo(
    () => (reduceMotion ? undefined : { color: palette.surfaceVariant, borderless: false }),
    [reduceMotion, palette.surfaceVariant],
  );

  useEffect(() => {
    const toOpacity = TARGET_OPACITY[state];
    const toScale = TARGET_SCALE[state];
    const toFocus = state === 'active' ? 1 : 0;

    if (reduceMotion) {
      opacity.stopAnimation();
      scale.stopAnimation();
      focus.stopAnimation();
      pressScale.stopAnimation();
      opacity.setValue(toOpacity);
      scale.setValue(toScale);
      focus.setValue(toFocus);
      pressScale.setValue(1);
      prevState.current = state;
      return;
    }
    if (prevState.current === state) return;
    prevState.current = state;

    const activating = state === 'active';
    const transition = Animated.parallel([
      Animated.timing(opacity, {
        toValue: toOpacity,
        duration: activating ? FADE_IN_MS : FADE_OUT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: toScale,
        speed: activating ? 18 : 22,
        bounciness: activating ? 4 : 0,
        useNativeDriver: true,
      }),
      Animated.spring(focus, {
        toValue: toFocus,
        speed: activating ? 16 : 22,
        bounciness: activating ? 3 : 0,
        useNativeDriver: true,
      }),
    ]);
    transition.start();
    return () => transition.stop();
  }, [state, reduceMotion, opacity, scale, focus, pressScale]);

  const pressIn = useCallback(() => {
    pressScale.stopAnimation();
    if (reduceMotion) {
      pressScale.setValue(1);
      return;
    }
    Animated.timing(pressScale, {
      toValue: 0.985,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [pressScale, reduceMotion]);
  const pressOut = useCallback(() => {
    pressScale.stopAnimation();
    if (reduceMotion) {
      pressScale.setValue(1);
      return;
    }
    Animated.spring(pressScale, {
      toValue: 1,
      speed: 28,
      bounciness: 2,
      useNativeDriver: true,
    }).start();
  }, [pressScale, reduceMotion]);

  const isActive = state === 'active';
  const content = (
    <Animated.View style={[styles.lineContent, { transform: [{ scale: pressScale }] }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.focusMarker,
          {
            backgroundColor: palette.accent,
            opacity: focus,
            transform: [{ scaleX: markerScaleX }],
          },
        ]}
      />
      <Animated.Text
        style={[
          styles.line,
          {
            color: palette.text,
            fontSize: isActive ? ACTIVE_SIZE : INACTIVE_SIZE,
            fontWeight: isActive ? '800' : '700',
            lineHeight: isActive ? 34 : 28,
            opacity,
            transform: [{ translateX: focusTranslateX }, { scale }],
          },
        ]}
      >
        {line.text || ' '}
      </Animated.Text>
    </Animated.View>
  );
  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    onRowLayout(index, y, height);
  };

  if (!synced) {
    return (
      <View onLayout={onLayout} style={styles.lineHit}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(index)}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onLayout={onLayout}
      android_ripple={ripple}
      accessibilityRole="button"
      accessibilityLabel={line.text || 'Baris kosong'}
      accessibilityHint="Lompat ke bagian lagu ini"
      accessibilityState={{ selected: isActive }}
      style={styles.lineHit}
    >
      {content}
    </Pressable>
  );
});

// ─── Main component ─────────────────────────────────────────────────────────

export function AnimatedLyricsView({
  videoId,
  palette,
  currentTime,
  glowColor,
  resource,
}: {
  videoId: string;
  palette: Palette;
  /** Playback position in seconds; drives synced-line focus. */
  currentTime: number;
  /** Ambient backlight tint; defaults to the signature amber glow. */
  glowColor?: string;
  resource: LyricsResource;
}) {
  const { lyrics: data, loading, failed, retry } = resource;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);

  const scrollRef = useRef<ScrollView>(null);
  const rowGeometry = useRef(new Map<number, RowGeometry>());
  const lastScrollTarget = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(enabled),
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Ambient glow breathing loop (opacity only, native-driver safe).
  const glow = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    glow.stopAnimation();
    if (reduceMotion) {
      glow.setValue(0.6);
      return;
    }

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
  }, [glow, reduceMotion]);


  const lines = useMemo(() => data?.lines ?? [], [data]);
  const synced = !!data?.synced && lines.some((line) => line.startMs !== undefined);
  const focusIndex = useMemo(
    () =>
      synced
        ? activeLineIndex(lines, currentTime * 1_000 + LYRIC_LOOKAHEAD_MS)
        : -1,
    [synced, lines, currentTime],
  );
  const position = useMemo(
    () => (synced ? timedLinePosition(lines, focusIndex) : null),
    [synced, lines, focusIndex],
  );

  useLayoutEffect(() => {
    rowGeometry.current.clear();
    lastScrollTarget.current = null;
  }, [videoId, data]);

  const scrollToFocus = useCallback(
    (index: number): void => {
      if (index < 0 || viewportHeight <= 0) return;
      const geometry = rowGeometry.current.get(index);
      if (!geometry) return;
      const target = focusScrollOffset(geometry.y, geometry.height, viewportHeight);
      if (target === lastScrollTarget.current) return;
      lastScrollTarget.current = target;
      scrollRef.current?.scrollTo({ y: target, animated: !reduceMotion });
    },
    [viewportHeight, reduceMotion],
  );

  useEffect(() => {
    scrollToFocus(focusIndex);
  }, [focusIndex, scrollToFocus]);

  const onRowLayout = useCallback(
    (index: number, y: number, height: number): void => {
      rowGeometry.current.set(index, { y, height });
      if (index === focusIndex) scrollToFocus(index);
    },
    [focusIndex, scrollToFocus],
  );

  const focusLine = useCallback(
    (index: number): void => {
      const timed = nearestTimedIndex(lines, index);
      const startMs = timed >= 0 ? lines[timed].startMs : undefined;
      if (startMs !== undefined) seekTo(startMs / 1_000);
      AccessibilityInfo.announceForAccessibility(lines[index]?.text ?? '');
    },
    [lines],
  );

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
          onPress={retry}
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
      {position ? (
        <View
          pointerEvents="none"
          accessible
          accessibilityLabel={`Posisi lirik ${position.current} dari ${position.total}`}
          style={styles.positionWrap}
        >
          <View
            style={[
              styles.positionBadge,
              { backgroundColor: palette.surfaceVariant, borderColor: palette.outline },
            ]}
          >
            <View style={[styles.positionDot, { backgroundColor: palette.accent }]} />
            <Text style={[styles.positionText, { color: palette.textSecondary }]}>
              {position.current}
              <Text style={{ color: palette.text }}> / {position.total}</Text>
            </Text>
          </View>
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        accessibilityLabel="Lirik lagu"
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        fadingEdgeLength={spacing.xxl}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: viewportHeight / 2,
            paddingBottom: viewportHeight / 2,
          },
        ]}
      >
        {lines.map((line, index) => {
          let lineState: LyricRowProps['state'];
          if (!synced) {
            lineState = 'unsync';
          } else if (focusIndex < 0) {
            lineState = 'future';
          } else if (index === focusIndex) {
            lineState = 'active';
          } else if (index < focusIndex) {
            lineState = 'past';
          } else {
            lineState = 'future';
          }

          return (
            <LyricRow
              key={`${index}-${line.text}`}
              line={line}
              index={index}
              state={lineState}
              palette={palette}
              synced={synced}
              reduceMotion={reduceMotion}
              onPress={focusLine}
              onRowLayout={onRowLayout}
            />
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
  positionWrap: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.lg,
    zIndex: 2,
  },
  positionBadge: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  positionDot: { width: 5, height: 5, borderRadius: 3 },
  positionText: {
    fontSize: typeScale.small,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
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
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  lineHit: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  lineContent: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  focusMarker: {
    position: 'absolute',
    left: 0,
    top: '50%',
    width: spacing.md,
    height: 3,
    marginTop: -1.5,
    borderRadius: radius.full,
    transformOrigin: 'left center',
  },
  line: {
    textAlign: 'left',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    transformOrigin: 'left center',
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
