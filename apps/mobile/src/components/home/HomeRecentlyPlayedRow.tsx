/**
 * Home "Recently played" row.
 *
 * Source priority when a YouTube cookie is present:
 *   1. Server history from GET /history (authoritative, newest-first).
 *   2. Local AsyncStorage items whose videoId is NOT on the server — append
 *      below so user keeps seeing very-recent plays (server history can lag).
 *
 * Source when no cookie or /history fails:
 *   - Local store only. Never an error toast, never a prompt.
 */
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { SectionHeader } from '../Icon';
import { history as fetchHistory } from '../../api/client';
import { getCookie } from '../../api/client';
import type { ParsedItem } from '../../api/types';
import { playSong } from '../../player/service';
import {
  getRecentlyPlayed,
  recentVideoIds,
  subscribeRecentlyPlayed,
  type RecentlyPlayed,
} from '../../storage/recentlyPlayed';
import { glass, spacing, typeScale } from '../../theme';
import type { Palette } from '../../theme';

const CARD_WIDTH = 132;
const THUMB_SIZE = 132;
const ROW_CAP = 30;

interface DisplayItem {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
}

/** Convert a server ParsedItem into our flat display shape. */
function fromServerItem(item: ParsedItem): DisplayItem | null {
  if (!item.videoId || !item.title) return null;
  const artist =
    item.artists?.map((a) => a.name).join(', ') ?? item.subtitle ?? '';
  return { videoId: item.videoId, title: item.title, artist, thumbnail: item.thumbnail };
}

/** Convert a local RecentlyPlayed into the display shape. */
function fromLocalItem(item: RecentlyPlayed): DisplayItem {
  return {
    videoId: item.videoId,
    title: item.title,
    artist: item.artist,
    thumbnail: item.thumbnail,
  };
}

export function HomeRecentlyPlayedRow({ palette }: { palette: Palette }) {
  const [items, setItems] = useState<DisplayItem[]>([]);

  // Pure-local refresh path: when no cookie, this is the only source.
  const renderLocalOnly = useCallback(() => {
    setItems(getRecentlyPlayed().slice(0, ROW_CAP).map(fromLocalItem));
  }, []);

  useEffect(() => subscribeRecentlyPlayed(() => renderLocalOnly()), [renderLocalOnly]);

  // Try server history on every focus when a cookie exists. Any failure
  // (network, 401, parse error) → fall back to local-only silently.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!(await getCookie())) {
          renderLocalOnly();
          return;
        }
        try {
          const { sections } = await fetchHistory();
          if (cancelled) return;
          const serverItems: DisplayItem[] = [];
          for (const sec of sections) {
            for (const raw of sec.items) {
              const converted = fromServerItem(raw);
              if (converted) serverItems.push(converted);
            }
          }
          // Server is authoritative; trim to cap.
          const cappedServer = serverItems.slice(0, ROW_CAP);
          // Append local items whose videoId is not already represented.
          // recentVideoIds() returns a fresh read-only Set; copy to a mutable
          // Set so we can seed it with the server items.
          const seen = new Set(recentVideoIds());
          for (const it of cappedServer) seen.add(it.videoId);
          const extras: DisplayItem[] = [];
          const slotsLeft = ROW_CAP - cappedServer.length;
          for (const local of getRecentlyPlayed()) {
            if (seen.has(local.videoId)) continue;
            if (extras.length >= slotsLeft) break;
            extras.push(fromLocalItem(local));
          }
          if (cancelled) return;
          setItems([...cappedServer, ...extras]);
        } catch {
          if (cancelled) return;
          renderLocalOnly();
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [renderLocalOnly]),
  );

  if (items.length === 0) {
    return (
      <View style={styles.block}>
        <SectionHeader title="Recently played" palette={palette} />
        <Text style={[styles.emptyText, { color: palette.textSecondary }]}>Putar lagu untuk mulai mengisi riwayat</Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <SectionHeader title="Recently played" palette={palette} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((item) => (
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
            <Text numberOfLines={2} style={[styles.title, { color: palette.text }]}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.lg },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  card: { width: CARD_WIDTH, gap: spacing.sm, backgroundColor: glass.surface, borderRadius: 12, borderWidth: 1, borderColor: glass.border, padding: spacing.sm, overflow: 'hidden' },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbFallbackText: { fontSize: typeScale.titleLarge, fontWeight: '700' },
  title: { fontSize: typeScale.body, fontWeight: '600' },
  emptyText: { paddingHorizontal: spacing.lg, fontSize: typeScale.body },
});