/**
 * Home "Pilihan cepat" (Quick picks) carousel.
 * Compact multi-column horizontal carousel with 6 items stacked vertically per column.
 * Sourced from the local recently-played store, excluding the items shown in the
 * Recently-played row above.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { SectionHeader } from '../Icon';
import { playSong } from '../../player/service';
import {
  ensureLoaded,
  subscribeRecentlyPlayed,
  type RecentlyPlayed,
} from '../../storage/recentlyPlayed';
import { glass, spacing, typeScale } from '../../theme';
import type { Palette } from '../../theme';

const ITEMS_PER_COLUMN = 6;
const MAX_TOTAL_ITEMS = 24;

/** HomeRecentlyPlayedRow shows up to MAX_VISIBLE in its horizontal scroll. */
const MAX_VISIBLE = 8;

export function HomeQuickPicksGrid({ palette }: { palette: Palette }) {
  const [items, setItems] = useState<RecentlyPlayed[]>([]);
  const { width } = useWindowDimensions();

  useEffect(() => {
    void ensureLoaded().then(setItems);
    return subscribeRecentlyPlayed(setItems);
  }, []);

  const pool = useMemo(() => {
    return items.length > MAX_VISIBLE
      ? items.slice(MAX_VISIBLE, MAX_VISIBLE + MAX_TOTAL_ITEMS)
      : items.slice(0, MAX_TOTAL_ITEMS);
  }, [items]);

  const chunks = useMemo(() => {
    const result: RecentlyPlayed[][] = [];
    for (let i = 0; i < pool.length; i += ITEMS_PER_COLUMN) {
      result.push(pool.slice(i, i + ITEMS_PER_COLUMN));
    }
    return result;
  }, [pool]);

  if (chunks.length === 0) return null;

  const columnWidth = Math.min(width - 48, 320);

  return (
    <View style={styles.block}>
      <SectionHeader title="Pilihan cepat" palette={palette} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {chunks.map((chunk, colIdx) => (
          <View key={colIdx} style={[styles.column, { width: columnWidth }]}>
            {chunk.map((item) => (
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
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              >
                {item.thumbnail ? (
                  <Image
                    source={{ uri: item.thumbnail }}
                    style={[styles.thumb, { backgroundColor: palette.surfaceVariant }]}
                  />
                ) : (
                  <View
                    style={[
                      styles.thumb,
                      styles.thumbFallback,
                      { backgroundColor: palette.surfaceVariant },
                    ]}
                  >
                    <Text
                      style={[
                        styles.thumbFallbackText,
                        { color: palette.textSecondary },
                      ]}
                    >
                      {item.title.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.meta}>
                  <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
                    {item.title}
                  </Text>
                  {item.artist ? (
                    <Text
                      numberOfLines={1}
                      style={[styles.subtitle, { color: palette.textSecondary }]}
                    >
                      {item.artist}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.lg },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  column: {
    gap: spacing.xs,
    backgroundColor: glass.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: glass.border,
    overflow: 'hidden',
    padding: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    gap: spacing.sm,
    paddingVertical: 2,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallbackText: {
    fontSize: typeScale.title,
    fontWeight: '700',
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: typeScale.label,
  },
});
