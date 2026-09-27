/**
 * Home "Pilihan cepat" (Quick picks) grid. A 3-column grid of square cards
 * sourced from the local recently-played store, excluding whatever the
 * Recently-played row above already shows (the first N items of the same
 * store). Capped at 12 cards. Hidden when there are no remaining items.
 */
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '../Icon';
import { playSong } from '../../player/service';
import { subscribeRecentlyPlayed, type RecentlyPlayed } from '../../storage/recentlyPlayed';
import { radius, spacing, typeScale } from '../../theme';
import type { Palette } from '../../theme';

const GRID_COLUMNS = 3;
const MAX_CARDS = 12;

/** HomeRecentlyPlayedRow shows up to MAX_VISIBLE in its horizontal scroll. */
const MAX_VISIBLE = 8;

export function HomeQuickPicksGrid({ palette }: { palette: Palette }) {
  const [items, setItems] = useState<RecentlyPlayed[]>([]);

  useEffect(() => subscribeRecentlyPlayed(setItems), []);

  const visible = useMemo(() => items.slice(MAX_VISIBLE, MAX_VISIBLE + MAX_CARDS), [items]);

  if (visible.length === 0) return null;

  return (
    <View style={styles.block}>
      <SectionHeader title="Pilihan cepat" palette={palette} />
      <View style={styles.grid}>
        {visible.map((item) => (
          <Pressable
            key={item.videoId}
            accessibilityRole="button"
            accessibilityLabel={`Putar ${item.title}`}
            onPress={() =>
              playSong({
                type: 'song',
                title: item.title,
                artists: item.artist ? [{ name: item.artist }] : undefined,
                thumbnail: item.thumbnail,
                videoId: item.videoId,
              }).catch(() => {})
            }
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.6 }]}
          >
            {item.thumbnail ? (
              <Image source={{ uri: item.thumbnail }} style={[styles.thumb, { backgroundColor: palette.surfaceVariant }]} />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: palette.surfaceVariant }]}>
                <Text style={[styles.thumbFallbackText, { color: palette.textSecondary }]}>
                  {item.title.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
              {item.title}
            </Text>
            {item.artist ? (
              <Text numberOfLines={1} style={[styles.subtitle, { color: palette.textSecondary }]}>
                {item.artist}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.lg },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    rowGap: spacing.md,
  },
  card: {
    width: `${100 / GRID_COLUMNS}%` as unknown as number,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: radius.md },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbFallbackText: { fontSize: typeScale.titleLarge, fontWeight: '700' },
  title: { fontSize: typeScale.label, fontWeight: '600' },
  subtitle: { fontSize: typeScale.label },
});