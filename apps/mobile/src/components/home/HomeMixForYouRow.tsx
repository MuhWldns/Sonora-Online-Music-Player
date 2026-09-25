/**
 * Home "Mix for you" row. One horizontal row of 8 cards seeded by the most
 * recent track in the local recently-played store. Re-uses the existing
 * `/next?videoId=…` proxy endpoint (same RDAMVM automix the player already
 * seeds with). Re-fetches when the seed changes. Hidden when there is no
 * recently-played track.
 */
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '../Icon';
import { next } from '../../api/client';
import type { QueueItem } from '../../api/types';
import { playSong } from '../../player/service';
import { subscribeRecentlyPlayed, type RecentlyPlayed } from '../../storage/recentlyPlayed';
import { spacing, typeScale } from '../../theme';
import type { Palette } from '../../theme';

const SEED_LIMIT = 8;

export function HomeMixForYouRow({ palette }: { palette: Palette }) {
  const [seed, setSeed] = useState<RecentlyPlayed | null>(null);
  const [tracks, setTracks] = useState<QueueItem[]>([]);

  useEffect(() => subscribeRecentlyPlayed((items) => setSeed(items[0] ?? null)), []);

  useEffect(() => {
    if (!seed) {
      setTracks([]);
      return;
    }
    let cancelled = false;
    next(seed.videoId)
      .then(({ queue }) => {
        if (cancelled) return;
        // /next returns the seed as `selected: true`; drop it so the row only
        // shows fresh recommendations.
        setTracks(queue.filter((t) => !t.selected).slice(0, SEED_LIMIT));
      })
      .catch(() => {
        if (cancelled) return;
        setTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [seed?.videoId, seed?.playedAt]);

  if (!seed || tracks.length === 0) return null;

  const title = `Mix for you · based on “${seed.title}”`;

  return (
    <View style={styles.block}>
      <SectionHeader title={title} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {tracks.map((track) => (
          <Pressable
            key={track.videoId}
            accessibilityRole="button"
            accessibilityLabel={`Putar ${track.title}`}
            onPress={() =>
              playSong({
                type: 'song',
                title: track.title,
                artists: track.artist ? [{ name: track.artist }] : undefined,
                thumbnail: track.thumbnail,
                videoId: track.videoId,
              }).catch(() => {})
            }
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.6 }]}
          >
            {track.thumbnail ? (
              <Image source={{ uri: track.thumbnail }} style={[styles.thumb, { backgroundColor: palette.surfaceVariant }]} />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: palette.surfaceVariant }]}>
                <Text style={[styles.thumbFallbackText, { color: palette.textSecondary }]}>
                  {track.title.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <Text numberOfLines={2} style={[styles.title, { color: palette.text }]}>
              {track.title}
            </Text>
            {track.artist ? (
              <Text numberOfLines={1} style={[styles.subtitle, { color: palette.textSecondary }]}>
                {track.artist}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.lg },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  card: { width: 152, gap: spacing.sm },
  thumb: { width: 152, height: 152, borderRadius: 8 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbFallbackText: { fontSize: typeScale.titleLarge, fontWeight: '700' },
  title: { fontSize: typeScale.body, fontWeight: '600' },
  subtitle: { fontSize: typeScale.label },
});