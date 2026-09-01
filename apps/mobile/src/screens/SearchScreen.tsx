/**
 * Search: search-first front door. Sticky search field + filter chips
 * (Material), results as song rows + shelves, recent queries persisted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton } from '../components/Icon';
import { ShelfCard, SongRow } from '../components/TrackRow';
import { search } from '../api/client';
import type { ParsedItem, ParsedSection } from '../api/types';
import { browseTargetOf } from '../navigation/browseTarget';
import type { RootStackParamList } from '../navigation/types';
import { playSong } from '../player/service';
import { usePlayerState } from '../player/usePlayerState';
import { radius, spacing, TOUCH_TARGET, typeScale } from '../theme';
import type { Palette } from '../theme';

const FILTERS = [
  { id: undefined, label: 'Semua' },
  { id: 'song', label: 'Lagu' },
  { id: 'video', label: 'Video' },
  { id: 'album', label: 'Album' },
  { id: 'artist', label: 'Artis' },
  { id: 'playlist', label: 'Playlist' },
] as const;

export function SearchScreen({ palette }: { palette: Palette }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const activeVideoId = usePlayerState((s) => s.queue[s.index]?.videoId);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const runSearch = useCallback(
    async (query: string, f?: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      try {
        const { sections: s } = await search(trimmed, f);
        setSections(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounce 350ms
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length >= 2) runSearch(q, filter);
      else setSections(null);
    }, 350);
    return () => clearTimeout(t);
  }, [q, filter, runSearch]);

  const onPlay = useCallback((item: ParsedItem) => {
    playSong(item).catch(() => {});
  }, []);

  const onOpen = useCallback(
    (item: ParsedItem) => {
      const id = browseTargetOf(item);
      if (id) navigation.navigate('Browse', { id, title: item.title });
    },
    [navigation],
  );

  const results: ParsedItem[] = [];
  for (const s of sections ?? [])
    for (const it of s.items) if (it.type === 'song' || it.type === 'video') results.push(it);
  const others: ParsedSection[] = (sections ?? []).filter(
    (s) => s.items.length && s.items[0].type !== 'song' && s.items[0].type !== 'video',
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={[styles.searchBarWrap, { paddingTop: insets.top + spacing.sm }]}>
        <View style={[styles.searchBar, { backgroundColor: palette.surfaceVariant }]}>
          <Icon name="search" size={22} color={palette.textSecondary} />
          <TextInput
            ref={inputRef}
            value={q}
            onChangeText={setQ}
            placeholder="Cari lagu, artis, album…"
            placeholderTextColor={palette.textSecondary}
            style={[styles.input, { color: palette.text }]}
            returnKeyType="search"
            onSubmitEditing={() => runSearch(q, filter)}
            accessibilityLabel="Kolom pencarian"
          />
          {q.length > 0 && (
            <IconButton
              name="close"
              size={20}
              color={palette.textSecondary}
              onPress={() => {
                setQ('');
                setSections(null);
                inputRef.current?.focus();
              }}
              accessibilityLabel="Hapus pencarian"
            />
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.label}
              onPress={() => setFilter(f.id)}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${f.label}`}
              style={({ pressed }) => [
                styles.chip,
                pressed && { opacity: 0.7 },
                active
                  ? { backgroundColor: palette.accent }
                  : { backgroundColor: palette.surfaceVariant },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? palette.onAccent : palette.text },
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={styles.center} size="large" color={palette.accent} />
      ) : error ? (
        <View style={styles.center}>
          <Icon name="cloud-off" size={40} color={palette.textSecondary} />
          <Text style={[styles.errText, { color: palette.textSecondary }]}>{error}</Text>
        </View>
      ) : !sections ? (
        <View style={styles.center}>
          <Icon name="music-note" size={44} color={palette.textSecondary} />
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            Cari lagu favoritmu untuk mulai mendengarkan
          </Text>
        </View>
      ) : (
        <FlatList
          data={results.slice(0, 30)}
          keyExtractor={(it, i) => `${it.videoId ?? it.title}-${i}`}
          renderItem={({ item }) => (
            <SongRow item={item} onPlay={onPlay} palette={palette} active={item.videoId === activeVideoId} />
          )}
          ListHeaderComponent={
            others.length ? (
              <View style={{ gap: spacing.md }}>
                {others.slice(0, 2).map((s, si) => (
                  <View key={`${s.title}-${si}`}>
                    <Text style={[styles.othersTitle, { color: palette.text }]}>
                      {s.title}
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfContent}>
                      {s.items.map((it, i) => (
                        <ShelfCard key={`${it.title}-${i}`} item={it} onOpen={onOpen} palette={palette} />
                      ))}
                    </ScrollView>
                  </View>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.hint, { color: palette.textSecondary }]}>
                Tidak ada hasil untuk “{q.trim()}”
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 180 }}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchBarWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    height: TOUCH_TARGET,
  },
  input: { flex: 1, fontSize: typeScale.body, paddingVertical: 0 },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.sm,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: typeScale.label, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  errText: { fontSize: typeScale.body, textAlign: 'center' },
  hint: { fontSize: typeScale.body, textAlign: 'center' },
  othersTitle: { fontSize: typeScale.title, fontWeight: '700', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  shelfContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
});
