/**
 * Apple Glass mini-player capsule docked above the tab bar.
 *
 * Translucent elevated glass surface with soft ambient shadow, 1px border,
 * tactile press animation, track thumbnail with fallback, high-contrast
 * metadata, playback toggle, next track control, and a bottom progress line.
 */
import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { usePlayerState } from '../../player/usePlayerState';
import { nextTrack, togglePlay } from '../../player/service';
import type { PlayerTrack } from '../../player/service';
import { glass, spacing, typeScale } from '../../theme';
import type { Palette } from '../../theme';
import { Icon, IconButton } from '../Icon';

export interface MiniPlayerProps {
  palette: Palette;
  onPress?: () => void;
  onExpand?: () => void;
  track?: PlayerTrack | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function MiniPlayer({
  palette,
  onPress,
  onExpand,
  track: trackProp,
  style,
  testID,
}: MiniPlayerProps) {
  const { queue, index, playing, currentTime, duration, error } = usePlayerState((s) => ({
    queue: s.queue,
    index: s.index,
    playing: s.playing,
    currentTime: s.currentTime,
    duration: s.duration,
    error: s.error,
  }));

  const track = trackProp ?? queue[index];
  const [thumbError, setThumbError] = useState(false);

  useEffect(() => {
    setThumbError(false);
  }, [track?.videoId, track?.thumbnail]);

  if (!track) {
    return null;
  }

  const handlePress = onExpand ?? onPress;
  const progressRatio =
    duration > 0 && Number.isFinite(duration) && Number.isFinite(currentTime)
      ? Math.max(0, Math.min(1, currentTime / duration))
      : 0;

  return (
    <View style={[styles.capsuleWrap, { backgroundColor: palette.surface }, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`Buka pemutar: ${track.title}`}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.capsule,
          {
            backgroundColor: glass.surfaceElevated,
            borderColor: glass.border,
            transform: [{ scale: pressed ? 0.98 : 1 }],
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
      {track.thumbnail && !thumbError ? (
        <Image
          source={{ uri: track.thumbnail }}
          style={styles.thumbnail}
          onError={() => setThumbError(true)}
          accessibilityLabel={track.title}
        />
      ) : (
        <View
          style={[
            styles.thumbnail,
            styles.fallbackThumbnail,
            { backgroundColor: glass.surfaceSubtle },
          ]}
        >
          <Icon name="music-note" size={24} color={palette.textSecondary} />
        </View>
      )}

      <View style={styles.metadata}>
        <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
          {track.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.artist, { color: error ? palette.error : palette.textSecondary }]}
        >
          {error ? `Error: ${error}` : track.artist}
        </Text>
      </View>

      <View style={styles.controls}>
        <IconButton
          name={playing ? 'pause' : 'play-arrow'}
          size={28}
          color={palette.text}
          onPress={togglePlay}
          accessibilityLabel={playing ? 'Jeda' : 'Putar'}
        />
        <IconButton
          name="skip-next"
          size={28}
          color={palette.text}
          onPress={nextTrack}
          accessibilityLabel="Berikutnya"
        />
      </View>

      <View pointerEvents="none" style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${progressRatio * 100}%`,
              backgroundColor: palette.accent,
            },
          ]}
        />
      </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  capsuleWrap: {
    marginHorizontal: spacing.sm,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  capsule: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 6,
    overflow: 'hidden',
  },
  fallbackThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: glass.border,
  },
  metadata: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.xs,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },
  artist: {
    fontSize: typeScale.label,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2.5,
    backgroundColor: glass.surfaceSubtle,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderBottomLeftRadius: 16,
  },
});
