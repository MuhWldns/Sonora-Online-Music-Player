/**
 * Global playback chrome: mini-player docked above the tab bar, expanding to
 * a full-player modal sheet. Canon streaming grammar (Spotify/YTM); Material 3
 * structure — tonal surface, 48dp controls, system back closes the sheet.
 */
import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { Icon, IconButton } from './Icon';
import type { IconName } from './Icon';
import { formatSec } from './TrackRow';
import {
  getState,
  nextTrack,
  playAt,
  prevTrack,
  seekTo,
  togglePlay,
} from '../player/service';
import { usePlayerState } from '../player/usePlayerState';
import { darkPalette, radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

function ProgressSlider({
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
  const { width } = useWindowDimensions();
  const trackW = Math.min(width - spacing.xl * 2, 400);
  const ratio = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const shown = scrubbing ?? ratio;

  function posToSec(x: number): number {
    return Math.max(0, Math.min(duration, (x / trackW) * duration));
  }

  return (
    <View style={s.progressWrap}>
      <Pressable
        accessibilityLabel="Ganti posisi lagu"
        accessibilityRole="adjustable"
        hitSlop={12}
        onLayout={(e) => {
          /* trackW fixed by calc; layout kept for future device changes */
        }}
        onPress={(e) => {
          const x = e.nativeEvent.locationX;
          onSeek(posToSec(x));
          setScrubbing(null);
        }}
        onPressOut={() => setScrubbing(null)}
        onPressIn={(e) => setScrubbing(posToSec(e.nativeEvent.locationX))}
      >
        <View style={[s.progressTrack, { backgroundColor: palette.outline }]}>
          <View
            style={{
              width: `${shown * 100}%`,
              backgroundColor: palette.text,
              height: '100%',
              borderRadius: 2,
            }}
          />
        </View>
      </Pressable>
      <View style={s.progressTimes}>
        <Text style={[s.time, { color: palette.textSecondary }]}>
          {formatSec(scrubbing ?? currentTime)}
        </Text>
        <Text style={[s.time, { color: palette.textSecondary }]}>{formatSec(duration)}</Text>
      </View>
    </View>
  );
}

function FullPlayer({ palette, onClose }: { palette: Palette; onClose: () => void }) {
  const { queue, index, playing, buffering, currentTime, duration, error } = usePlayerState(
    (s) => s,
  );
  const track = queue[index];
  const [queueOpen, setQueueOpen] = useState(false);
  const insets = useSafeAreaInsets();

  if (!track) return null;

  return (
    <Modal
      animationType="slide"
      visible
      statusBarTranslucent
      onRequestClose={() => (queueOpen ? setQueueOpen(false) : onClose())}
    >
      <View style={[s.sheet, { backgroundColor: palette.background, paddingTop: insets.top + spacing.sm }]}>
        <StatusBar style={palette === darkPalette ? 'light' : 'dark'} />
        <View style={s.sheetGrabRow}>
          <IconButton
            name="keyboard-arrow-down"
            color={palette.textSecondary}
            onPress={onClose}
            accessibilityLabel="Tutup pemutar"
          />
          <Text style={[s.sheetContext, { color: palette.textSecondary }]}>
            Sedang diputar
          </Text>
          <IconButton
            name={queueOpen ? 'album' : 'queue-music'}
            color={palette.textSecondary}
            onPress={() => setQueueOpen(!queueOpen)}
            accessibilityLabel={queueOpen ? 'Lihat sampul' : 'Lihat antrean'}
          />
        </View>

        {queueOpen ? (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
            {queue.map((t, i) => (
              <Pressable
                key={`${t.videoId}-${i}`}
                onPress={() => playAt(i)}
                accessibilityRole="button"
                accessibilityLabel={`Putar ${t.title}`}
                style={({ pressed }) => [s.qRow, pressed && { opacity: 0.6 }]}
              >
                <Image source={{ uri: t.thumbnail ?? undefined }} style={s.qThumb} />
                <View style={s.qMeta}>
                  <Text
                    numberOfLines={1}
                    style={[
                      s.qTitle,
                      { color: i === index ? palette.accentText : palette.text },
                    ]}
                  >
                    {t.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[s.qSub, { color: palette.textSecondary }]}
                  >
                    {t.artist}
                  </Text>
                </View>
                {i === index && playing ? (
                  <Icon name="graphic-eq" size={20} color={palette.accentText} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <View style={s.sheetBody}>
            {track.thumbnail ? (
              <Image source={{ uri: track.thumbnail }} style={s.art} />
            ) : (
              <View style={[s.art, { backgroundColor: palette.surfaceVariant }]}>
                <Icon name="music-note" size={64} color={palette.textSecondary} />
              </View>
            )}
            <View style={s.titleBlock}>
              <Text style={[s.trackTitle, { color: palette.text }]} numberOfLines={2}>
                {track.title}
              </Text>
              <Text style={[s.trackArtist, { color: palette.textSecondary }]} numberOfLines={1}>
                {track.artist}
              </Text>
            </View>
            {buffering ? (
              <Text style={[s.bufState, { color: palette.textSecondary }]}>
                Memuat… {error ? `(${error})` : ''}
              </Text>
            ) : error ? (
              <Text style={[s.bufState, { color: palette.error }]}>Gagal memuat: {error}</Text>
            ) : null}
            <ProgressSlider
              currentTime={currentTime}
              duration={duration}
              palette={palette}
              onSeek={seekTo}
            />
            <View style={s.controls}>
              <IconButton
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
                style={({ pressed }) => [s.playBtn, pressed && { opacity: 0.8 }]}
              >
                <Icon name={playing ? 'pause' : 'play-arrow'} size={44} color={palette.text} />
              </Pressable>
              <IconButton
                name="skip-next"
                size={40}
                color={palette.text}
                onPress={nextTrack}
                accessibilityLabel="Berikutnya"
              />
            </View>
            <View style={s.miniStateRow}>
              {index + 1}/{queue.length} dalam antrean
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

/** Docked above the tab bar whenever a track has been loaded. */
export function PlayerChrome({ palette }: { palette: Palette }) {
  const { index, playing, queue, error } = usePlayerState((s) => ({
    index: s.index, playing: s.playing, queue: s.queue, error: s.error,
  }));
  const track = queue[index];
  const [open, setOpen] = useState(false);
  const showMini = !!track && !open;
  const miniAnim = useMemo(() => ({ opacity: track ? 1 : 0 }), [track]);

  return (
    <>
      {showMini && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Buka pemutar: ${track.title}`}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [s.mini, pressed && { opacity: 0.85 }, { backgroundColor: palette.surfaceVariant }]}
        >
          {track.thumbnail ? (
            <Image source={{ uri: track.thumbnail }} style={s.miniThumb} />
          ) : (
            <View style={[s.miniThumb, { backgroundColor: palette.outline }]} />
          )}
          <View style={s.miniMeta}>
            <Text numberOfLines={1} style={[s.miniTitle, { color: palette.text }]}>
              {track.title}
            </Text>
            <Text numberOfLines={1} style={[s.miniSub, { color: error ? palette.error : palette.textSecondary }]}>
              {error ? `Error: ${error}` : track.artist}
            </Text>
          </View>
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
        </Pressable>
      )}
      {open && <FullPlayer palette={palette} onClose={() => setOpen(false)} />}
    </>
  );
}

const s = StyleSheet.create({
  mini: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    elevation: 2,
  },
  miniThumb: { width: 44, height: 44, borderRadius: 6 },
  miniMeta: { flex: 1, gap: 1 },
  miniTitle: { fontSize: typeScale.body, fontWeight: '600' },
  miniSub: { fontSize: typeScale.label },
  sheet: { flex: 1 },
  sheetGrabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  sheetContext: { fontSize: typeScale.label, fontWeight: '600', letterSpacing: 0.2 },
  sheetBody: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl, gap: spacing.lg },
  art: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: 'transparent' },
  titleBlock: { alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.md },
  trackTitle: { fontSize: typeScale.titleLarge, fontWeight: '700', letterSpacing: -0.2 },
  trackArtist: { fontSize: typeScale.body },
  bufState: { fontSize: typeScale.label },
  progressWrap: { alignSelf: 'stretch', marginTop: spacing.sm, gap: spacing.xs },
  progressTrack: { height: 4, borderRadius: 2 },
  progressTimes: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: typeScale.small, fontVariant: ['tabular-nums'] },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  playBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  miniStateRow: { color: '#888', fontSize: typeScale.small, marginTop: spacing.xs },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  qThumb: { width: 44, height: 44, borderRadius: 4 },
  qMeta: { flex: 1, gap: 2 },
  qTitle: { fontSize: typeScale.body, fontWeight: '600' },
  qSub: { fontSize: typeScale.label },
});
