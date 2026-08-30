/**
 * Library: liked songs & akun (cookie). Anonymous → login guidance state
 * (principle 5: anonymous tetap fungsional, bukan error). 401 → login state.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../components/Icon';
import { SongRow } from '../components/TrackRow';
import { library } from '../api/library';
import { getCookie } from '../api/client';
import type { ParsedItem, ParsedSection } from '../api/types';
import { usePlayerState } from '../player/usePlayerState';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { playQueue, playSong } from '../player/service';
import { spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

export function LibraryScreen({ palette }: { palette: Palette }) {
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activeVideoId = usePlayerState((s) => s.queue[s.index]?.videoId);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!(await getCookie())) {
        setNeedsLogin(true);
        setSections(null);
        return;
      }
      const { sections: s } = await library();
      setNeedsLogin(false);
      setSections(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'login') {
        setNeedsLogin(true);
        setSections(null);
        return;
      }
      setError(msg);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onPlay = useCallback((item: ParsedItem) => {
    playSong(item).catch(() => {});
  }, []);

  if (needsLogin)
    return (
      <View style={[styles.center, { backgroundColor: palette.background, paddingTop: insets.top }]}>
        <Icon name="lock-outline" size={40} color={palette.textSecondary} />
        <Text style={[styles.title, { color: palette.text }]}>Perlu login</Text>
        <Text style={[styles.body, { color: palette.textSecondary }]}>
          Library berisi lagu dan playlist dari akun YouTube Musicmu. Tambahkan
          cookie akun di Settings untuk melanjutkan.
        </Text>
      </View>
    );

  if (!sections && !error)
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );

  if (error && !sections)
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Icon name="cloud-off" size={40} color={palette.textSecondary} />
        <Text style={[styles.body, { color: palette.textSecondary }]}>{error}</Text>
        <Pressable onPress={load} style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }, { backgroundColor: palette.accent }]}>
          <Text style={[styles.retryText, { color: palette.onAccent }]}>Coba lagi</Text>
        </Pressable>
      </View>
    );

  const songs = (sections ?? []).flatMap((s) =>
    s.items.filter((it) => it.type === 'song' || it.type === 'video'),
  );

  return (
    <FlatList
      data={songs.slice(0, 50)}
      keyExtractor={(it, i) => `${it.videoId ?? it.title}-${i}`}
      renderItem={({ item }) => (
        <SongRow item={item} onPlay={onPlay} palette={palette} active={item.videoId === activeVideoId} />
      )}
      ListHeaderComponent={
        <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          <Text style={[styles.title, { color: palette.text }]}>Library</Text>
          {songs.length > 0 && (
            <Pressable
              onPress={() => playQueue(songs)}
              accessibilityRole="button"
              accessibilityLabel="Putar semua"
              style={({ pressed }) => [styles.playAll, pressed && { opacity: 0.7 }, { backgroundColor: palette.accent }]}
            >
              <Icon name="play-arrow" size={22} color={palette.onAccent} />
              <Text style={[styles.playAllText, { color: palette.onAccent }]}>Putar semua</Text>
            </Pressable>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={[styles.body, { color: palette.textSecondary }]}>
            Belum ada lagu di library. Suka lagu dari YouTube Music untuk
            mengisinya.
          </Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={palette.accent}
        />
      }
      contentContainerStyle={{ paddingBottom: 180 }}
      style={{ backgroundColor: palette.background }}
    />
  );
}


const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontSize: typeScale.display, fontWeight: '800', letterSpacing: -0.5 },
  body: { fontSize: typeScale.body, textAlign: 'center' },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 24,
  },
  playAllText: { fontSize: typeScale.label, fontWeight: '700' },
  retry: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 24 },
  retryText: { fontSize: typeScale.body, fontWeight: '700' },
});
