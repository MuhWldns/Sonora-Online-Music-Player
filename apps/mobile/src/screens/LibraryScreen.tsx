/**
 * Library: liked songs & akun (cookie). Anonymous → login guidance state
 * (principle 5: anonymous tetap fungsional, bukan error). 401 → login state.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Icon, IconButton, SectionHeader } from '../components/Icon';
import { CreatePlaylistDialog } from '../components/CreatePlaylistDialog';
import { ShelfCard, SongRow } from '../components/TrackRow';
import { library } from '../api/library';
import { getCookie } from '../api/client';
import type { ParsedItem, ParsedSection } from '../api/types';
import { usePlayerState } from '../player/usePlayerState';
import type { RootStackParamList } from '../navigation/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addItemToQueue, playQueue, playSong } from '../player/service';
import { spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

export function LibraryScreen({ palette }: { palette: Palette }) {
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activeVideoId = usePlayerState((s) => s.queue[s.index]?.videoId);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!(await getCookie())) {
        setNeedsLogin(true);
        setSections(null);
        return;
      }
      const { sections: nextSections } = await library();
      setNeedsLogin(false);
      setSections(nextSections);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message === 'login') {
        setNeedsLogin(true);
        setSections(null);
        return;
      }
      setError(message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const songs = useMemo(
    () =>
      (sections ?? []).flatMap((section) =>
        section.items.filter((item) => item.type === 'song' || item.type === 'video'),
      ),
    [sections],
  );
  const playlists = useMemo(() => {
    const seen = new Set<string>();
    const items: ParsedItem[] = [];
    for (const section of sections ?? []) {
      for (const item of section.items) {
        if (item.type !== 'playlist') continue;
        const id = item.browseId ?? item.playlistId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        items.push(item);
      }
    }
    return items;
  }, [sections]);

  const onPlay = useCallback((item: ParsedItem) => {
    playSong(item).catch(() => {});
  }, []);
  const onOpenPlaylist = useCallback(
    (item: ParsedItem) => {
      const id = item.browseId ?? item.playlistId;
      if (id) navigation.navigate('Browse', { id, title: item.title });
    },
    [navigation],
  );

  if (needsLogin) {
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
  }

  if (!sections && !error) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );
  }

  if (error && !sections) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Icon name="cloud-off" size={40} color={palette.textSecondary} />
        <Text style={[styles.body, { color: palette.textSecondary }]}>{error}</Text>
        <Pressable
          onPress={load}
          style={({ pressed }) => [
            styles.retry,
            pressed && { opacity: 0.7 },
            { backgroundColor: palette.accent },
          ]}
        >
          <Text style={[styles.retryText, { color: palette.onAccent }]}>Coba lagi</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={songs.slice(0, 50)}
        keyExtractor={(item, index) => `${item.videoId ?? item.title}-${index}`}
        renderItem={({ item }) => (
          <SongRow
            item={item}
            onPlay={onPlay}
            onAddToQueue={addItemToQueue}
            palette={palette}
            active={item.videoId === activeVideoId}
          />
        )}
        ListHeaderComponent={
          <View>
            <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
              <Text style={[styles.title, { color: palette.text }]}>Library</Text>
              <View style={styles.headerActions}>
                {songs.length > 0 ? (
                  <Pressable
                    onPress={() => playQueue(songs)}
                    accessibilityRole="button"
                    accessibilityLabel="Putar semua"
                    style={({ pressed }) => [
                      styles.playAll,
                      pressed && { opacity: 0.7 },
                      { backgroundColor: palette.accent },
                    ]}
                  >
                    <Icon name="play-arrow" size={22} color={palette.onAccent} />
                    <Text style={[styles.playAllText, { color: palette.onAccent }]}>Putar</Text>
                  </Pressable>
                ) : null}
                <IconButton
                  name="playlist-add"
                  size={26}
                  color={palette.text}
                  onPress={() => setCreateOpen(true)}
                  accessibilityLabel="Buat playlist baru"
                />
              </View>
            </View>
            {playlists.length > 0 ? (
              <View style={styles.playlistBlock}>
                <SectionHeader title="Playlist" palette={palette} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.playlistShelf}
                >
                  {playlists.map((item, index) => (
                    <ShelfCard
                      key={`${item.browseId ?? item.playlistId ?? item.title}-${index}`}
                      item={item}
                      onOpen={onOpenPlaylist}
                      palette={palette}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}
            {songs.length > 0 ? (
              <SectionHeader title="Lagu" palette={palette} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.body, { color: palette.textSecondary }]}>
              Belum ada lagu tersimpan. Kamu tetap dapat membuat playlist baru.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await load();
              } finally {
                setRefreshing(false);
              }
            }}
            tintColor={palette.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 180 }}
        style={{ backgroundColor: palette.background }}
      />
      <CreatePlaylistDialog
        visible={createOpen}
        palette={palette}
        onClose={() => setCreateOpen(false)}
        onCreated={(playlistId, title) => {
          setCreateOpen(false);
          void load();
          navigation.navigate('Browse', { id: playlistId, title });
        }}
      />
    </>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  playlistBlock: { marginBottom: spacing.xl },
  playlistShelf: { paddingHorizontal: spacing.lg, gap: spacing.md },
  empty: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl },
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
