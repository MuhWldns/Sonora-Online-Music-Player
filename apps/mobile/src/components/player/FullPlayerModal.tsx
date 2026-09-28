/**
 * Full player modal: deep dark glass canvas with an ambient artwork glow,
 * frosted capsule view toggle (Lirik / Antrean) in the header, and fluid
 * switching between artwork, queue, and animated lyrics. 48dp tactile
 * controls (scale 0.96 on press); system back closes sub-views first.
 */
import { useState } from 'react';
import { Animated, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { usePlayerState } from '../../player/usePlayerState';
import { nextTrack, prevTrack, seekTo, togglePlay } from '../../player/service';
import { darkPalette, glass, radius, spacing, typeScale } from '../../theme';
import type { Palette } from '../../theme';
import { Icon, IconButton } from '../Icon';
import { AnimatedLyricsView } from './AnimatedLyricsView';
import { ProgressSlider } from './ProgressSlider';
import { lyricPreviewText } from './lyricsPosition';
import { useLyricsResource } from './useLyricsResource';
import { QueueEditor } from './QueueEditor';

/** Which body view the header capsule selects. Artwork is the default. */
type SheetView = 'artwork' | 'lyrics' | 'queue';

export function FullPlayerModal({ palette, onClose }: { palette: Palette; onClose: () => void }) {
  const { queue, index, playing, buffering, currentTime, duration, shuffle, error } =
    usePlayerState((s) => ({
      queue: s.queue,
      index: s.index,
      playing: s.playing,
      buffering: s.buffering,
      currentTime: s.currentTime,
      duration: s.duration,
      shuffle: s.shuffle,
      error: s.error,
    }));
  const track = queue[index];
  const lyricsResource = useLyricsResource(track?.videoId);
  const lyricPreview = lyricsResource.lyrics
    ? lyricPreviewText(
        lyricsResource.lyrics.lines,
        lyricsResource.lyrics.synced,
        currentTime * 1_000,
      )
    : '';
  const [view, setView] = useState<SheetView>('artwork');
  const insets = useSafeAreaInsets();

  const closeOrBack = () => {
    if (view !== 'artwork') {
      setView('artwork');
    } else {
      onClose();
    }
  };

  if (!track) return null;

  return (
    <Modal animationType="slide" visible statusBarTranslucent onRequestClose={closeOrBack}>
      <View
        style={[
          styles.sheet,
          { backgroundColor: palette.background, paddingTop: insets.top + spacing.sm },
        ]}
      >
        <StatusBar style={palette === darkPalette ? 'light' : 'dark'} />

        {/* Ambient artwork glow bleeding over the glass canvas. */}
        <View pointerEvents="none" style={styles.ambientWrap}>
          <View style={[styles.ambientGlow, { backgroundColor: glass.glow }]} />
        </View>

        <View style={styles.grabRow}>
          <IconButton
            name="keyboard-arrow-down"
            color={palette.textSecondary}
            onPress={closeOrBack}
            accessibilityLabel="Tutup pemutar"
          />
          <Text style={[styles.context, { color: palette.textSecondary }]}>Sedang diputar</Text>
          <View style={styles.grabSpacer} />
        </View>

        <View
          style={[
            styles.toggleCapsule,
            { backgroundColor: glass.surface, borderColor: glass.border },
          ]}
          accessibilityRole="tablist"
        >
          <CapsuleTab
            label="Lirik"
            icon="notes"
            active={view === 'lyrics'}
            palette={palette}
            onPress={() => setView(view === 'lyrics' ? 'artwork' : 'lyrics')}
          />
          <CapsuleTab
            label="Antrean"
            icon="queue-music"
            active={view === 'queue'}
            palette={palette}
            onPress={() => setView(view === 'queue' ? 'artwork' : 'queue')}
          />
        </View>

        {view === 'queue' ? (
          <QueueEditor
            queue={queue}
            index={index}
            playing={playing}
            shuffle={shuffle}
            palette={palette}
            bottomInset={insets.bottom}
          />
        ) : view === 'lyrics' ? (
          <AnimatedLyricsView
            key={track.videoId}
            videoId={track.videoId}
            palette={palette}
            currentTime={currentTime}
            resource={lyricsResource}
          />
        ) : (
          <View style={styles.body}>
            {track.thumbnail ? (
              <Image source={{ uri: track.thumbnail }} style={styles.art} />
            ) : (
              <View
                style={[
                  styles.art,
                  {
                    backgroundColor: glass.surface,
                    borderColor: glass.border,
                    borderWidth: 1,
                  },
                ]}
              >
                <Icon name="music-note" size={64} color={palette.textSecondary} />
              </View>
            )}
            <View style={styles.titleBlock}>
              <Text style={[styles.trackTitle, { color: palette.text }]} numberOfLines={2}>
                {track.title}
              </Text>
              <Text
                style={[styles.trackArtist, { color: palette.textSecondary }]}
                numberOfLines={1}
              >
                {track.artist}
              </Text>
            </View>
            {buffering ? (
              <Text style={[styles.bufState, { color: palette.textSecondary }]}>
                Memuat… {error ? `(${error})` : ''}
              </Text>
            ) : error ? (
              <Text style={[styles.bufState, { color: palette.error }]}>Gagal memuat: {error}</Text>
            ) : null}
            <View style={styles.progressBlock}>
              <ProgressSlider
                currentTime={currentTime}
                duration={duration}
                palette={palette}
                onSeek={seekTo}
              />
              <View style={styles.lyricPreviewSlot}>
                <Text
                  style={[styles.lyricPreview, { color: palette.textSecondary }]}
                  numberOfLines={1}
                >
                  {lyricPreview || ' '}
                </Text>
              </View>
            </View>
            <View style={styles.controls}>
              <TactileIcon
                name="skip-previous"
                size={40}
                color={palette.text}
                onPress={prevTrack}
                accessibilityLabel="Sebelumnya"
              />
              <Pressable
                onPress={togglePlay}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Jeda' : 'Putar'}
                style={({ pressed }) => [
                  styles.playBtn,
                  {
                    backgroundColor: glass.surfaceElevated,
                    borderColor: glass.borderHighlight,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  },
                ]}
              >
                <Icon name={playing ? 'pause' : 'play-arrow'} size={44} color={palette.text} />
              </Pressable>
              <TactileIcon
                name="skip-next"
                size={40}
                color={palette.text}
                onPress={nextTrack}
                accessibilityLabel="Berikutnya"
              />
            </View>
            <Text style={[styles.stateRow, { color: palette.textSecondary }]}>
              {index + 1}/{queue.length} dalam antrean
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

/** Frosted capsule segment: accent-tinted glass when active, 1px highlight. */
function CapsuleTab({
  label,
  icon,
  active,
  palette,
  onPress,
}: {
  label: string;
  icon: 'notes' | 'queue-music';
  active: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.capsuleTab,
        {
          backgroundColor: active ? glass.pillActive : 'transparent',
          borderColor: active ? glass.borderHighlight : 'transparent',
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
    >
      <Icon name={icon} size={18} color={active ? palette.accent : palette.textSecondary} />
      <Text
        style={[
          styles.capsuleLabel,
          { color: active ? palette.accentText : palette.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** 48dp control with tactile press-down scale feedback. */
function TactileIcon({
  name,
  size,
  color,
  onPress,
  accessibilityLabel,
}: {
  name: 'skip-previous' | 'skip-next';
  size: number;
  color: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.tactileTarget,
        { transform: [{ scale: pressed ? 0.96 : 1 }], opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  ambientWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
  },
  ambientGlow: {
    position: 'absolute',
    top: -140,
    width: 380,
    height: 380,
    borderRadius: 190,
  },
  grabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  grabSpacer: { width: 48 },
  context: { fontSize: typeScale.label, fontWeight: '600', letterSpacing: 0.2 },
  toggleCapsule: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.sm,
    padding: 4,
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  capsuleTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  capsuleLabel: { fontSize: typeScale.label, fontWeight: '700' },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  art: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.md },
  trackTitle: { fontSize: typeScale.titleLarge, fontWeight: '700', letterSpacing: -0.2 },
  trackArtist: { fontSize: typeScale.body },
  bufState: { fontSize: typeScale.label },
  progressBlock: { alignSelf: 'stretch', gap: spacing.sm },
  lyricPreviewSlot: {
    minHeight: 20,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  lyricPreview: {
    fontSize: typeScale.label,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
  controls: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  playBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  stateRow: { fontSize: typeScale.small, marginTop: spacing.xs },
  tactileTarget: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Animated re-export keeps the module surface stable for gesture drivers.
export const fullPlayerAnimated = Animated;
