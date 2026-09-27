/**
 * Playback progress slider: translucent glass track, accent fill, tactile
 * scrub thumb that grows while dragging. Width comes from onLayout so taps
 * map to the correct second at any container size.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { glass, spacing, typeScale } from '../../theme';
import type { Palette } from '../../theme';
import { formatSec } from '../TrackRow';

export function ProgressSlider({
  currentTime,
  duration,
  palette,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  palette: Palette;
  onSeek: (sec: number) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const shownSec = scrubbing ?? currentTime;
  // Fill width needs a 0..1 fraction; scrubbing holds seconds, so derive it.
  const ratio = duration > 0 ? Math.max(0, Math.min(1, shownSec / duration)) : 0;

  function posToSec(x: number): number {
    // `!(...)` also catches NaN, which a plain `<= 0` comparison would let through.
    if (!(trackW > 0) || !(duration > 0)) return 0;
    const clamped = Math.max(0, Math.min(trackW, x));
    return (clamped / trackW) * duration;
  }

  return (
    <View style={styles.wrap}>
      <View
        accessibilityLabel="Ganti posisi lagu"
        accessibilityRole="adjustable"
        accessibilityValue={{
          min: 0,
          max: Math.max(1, Math.round(duration)),
          now: Math.round(shownSec),
        }}
        // Taller hit area than the 4dp visual track so the thumb is grabbable.
        style={styles.hit}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setScrubbing(posToSec(e.nativeEvent.locationX))}
        onResponderMove={(e) => setScrubbing(posToSec(e.nativeEvent.locationX))}
        onResponderRelease={(e) => {
          onSeek(posToSec(e.nativeEvent.locationX));
          setScrubbing(null);
        }}
        onResponderTerminate={() => setScrubbing(null)}
      >
        <View style={[styles.track, { backgroundColor: glass.surfaceElevated }]}>
          <View
            style={{
              width: `${ratio * 100}%`,
              backgroundColor: palette.accent,
              height: '100%',
              borderRadius: 2,
            }}
          />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            scrubbing !== null && styles.thumbActive,
            {
              backgroundColor: palette.accent,
              borderColor: 'rgba(255,255,255,0.6)',
              borderWidth: 2,
              left: trackW > 0 ? `${ratio * 100}%` : 0,
            },
          ]}
        />
      </View>
      <View style={styles.times}>
        <Text style={[styles.time, { color: palette.textSecondary }]}>
          {formatSec(shownSec)}
        </Text>
        <Text style={[styles.time, { color: palette.textSecondary }]}>{formatSec(duration)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', marginTop: spacing.sm, gap: spacing.xs },
  // Visual track stays thin; the hit area is padded so dragging is comfortable.
  hit: { height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
  // Thumb swells while scrubbing so the finger has visible purchase.
  thumbActive: { width: 16, height: 16, borderRadius: 8, marginLeft: -8 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: typeScale.small, fontVariant: ['tabular-nums'] },
});
