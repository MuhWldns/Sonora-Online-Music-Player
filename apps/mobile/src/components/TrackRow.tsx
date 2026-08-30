/**
 * Track rows (song list item) — the workhorse row of every streaming app.
 * Two variants: compact (search/results/library) and with-eq (queue sheet).
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import type { IconName } from './Icon';
import { usePlayerState } from '../player/usePlayerState';
import { spacing, typeScale } from '../theme';
import type { Palette } from '../theme';
import type { ParsedItem } from '../api/types';

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DURATION_RE = /^(\d+:)+\d+$/;
function parseDur(d?: string): number {
  if (!d || !DURATION_RE.test(d)) return 0;
  return d.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function SongRow({
  item,
  onPlay,
  palette,
  active,
}: {
  item: ParsedItem;
  onPlay: (i: ParsedItem) => void;
  palette: Palette;
  active: boolean;
}) {
  const artist = item.artists?.map((a) => a.name).join(', ') || item.subtitle || '';
  return (
    <Pressable
      onPress={() => onPlay(item)}
      disabled={!item.videoId}
      accessibilityRole="button"
      accessibilityLabel={`Putar ${item.title}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <Image
        source={{ uri: item.thumbnail ?? undefined }}
        style={styles.thumb}
        accessibilityLabel={undefined}
      />
      <View style={styles.meta}>
        <Text
          numberOfLines={1}
          style={[styles.title, { color: active ? palette.accentText : palette.text }]}
        >
          {item.title}
        </Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: palette.textSecondary }]}>
          {artist ? `${artist} • ` : ''}
          {item.type === 'song' || item.type === 'video' ? item.duration ?? '' : item.type}
        </Text>
      </View>
      {active ? (
        <Icon name="graphic-eq" size={20} color={palette.accentText} />
      ) : item.duration && (item.type === 'song' || item.type === 'video') ? (
        <Text style={[styles.dur, { color: palette.textSecondary }]}>{item.duration}</Text>
      ) : null}
    </Pressable>
  );
}

/** Horizontal shelf card (album/artist/playlist/mixed). */
export function ShelfCard({
  item,
  onOpen,
  palette,
}: {
  item: ParsedItem;
  onOpen: (i: ParsedItem) => void;
  palette: Palette;
}) {
  const square = item.type !== 'artist';
  const subtitle =
    item.artists?.map((a) => a.name).join(', ') ||
    item.subtitle ||
    (item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : '');
  return (
    <Pressable
      onPress={() => onOpen(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title} — ${subtitle}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
    >
      {item.thumbnail ? (
        <Image
          source={{ uri: item.thumbnail }}
          style={square ? styles.cardImgSquare : styles.cardImgCircle}
        />
      ) : (
        <View
          style={[square ? styles.cardImgSquare : styles.cardImgCircle, styles.cardFallback]}
        >
          <Icon name="album" size={28} color={palette.textSecondary} />
        </View>
      )}
      <Text numberOfLines={1} style={[styles.cardTitle, { color: palette.text }]}>
        {item.title}
      </Text>
      <Text numberOfLines={1} style={[styles.cardSub, { color: palette.textSecondary }]}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

export function songDurationOf(item: ParsedItem): number {
  return parseDur(item.duration);
}

export function formatSec(sec: number): string {
  return fmt(sec);
}

export const ROW_HEIGHT = 64;

export function RowPlaceholder({ palette }: { palette: Palette }) {
  return <View style={[styles.row, { opacity: 0.4 }]}>
    <View style={[styles.thumb, { backgroundColor: palette.outline }]} />
    <View style={styles.meta}>
      <View style={[styles.phLine, { backgroundColor: palette.outline, width: '70%' }]} />
      <View style={[styles.phLine, { backgroundColor: palette.outline, width: '45%' }]} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  thumb: { width: 48, height: 48, borderRadius: 4 },
  meta: { flex: 1, gap: 2 },
  title: { fontSize: typeScale.body, fontWeight: '600' },
  subtitle: { fontSize: typeScale.label },
  dur: { fontSize: typeScale.label, fontVariant: ['tabular-nums'] },
  card: { width: 152, gap: spacing.sm },
  cardImgSquare: { width: 152, height: 152, borderRadius: 8 },
  cardImgCircle: { width: 152, height: 152, borderRadius: 76 },
  cardFallback: { alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: typeScale.body, fontWeight: '600' },
  cardSub: { fontSize: typeScale.label },
  phLine: { height: 12, borderRadius: 4 },
});
