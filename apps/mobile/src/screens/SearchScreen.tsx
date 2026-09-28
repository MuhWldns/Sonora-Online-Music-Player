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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton } from '../components/Icon';
import { ShelfCard, SongRow } from '../components/TrackRow';
import { SearchTopResultCard } from '../components/SearchTopResultCard';
import { home, search } from '../api/client';
import type { ParsedItem, ParsedSection } from '../api/types';
import { browseTargetOf } from '../navigation/browseTarget';
import type { RootStackParamList } from '../navigation/types';
import { addItemToQueue, playSong } from '../player/service';
import { usePlayerState } from '../player/usePlayerState';
import {
  ensureLoaded as ensureRecentlyPlayedLoaded,
  type RecentlyPlayed,
} from '../storage/recentlyPlayed';
import {
  localDayKey,
  selectDailyRecommendations,
  type SearchHistoryEntry,
} from '../storage/searchDiscoveryPolicy';
import {
  clearSearchHistory,
  deleteSearchQuery,
  getSearchHistory,
  recordSearchQuery,
} from '../storage/searchHistory';
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
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [dailyItems, setDailyItems] = useState<ParsedItem[]>([]);
  const [discoveryLoaded, setDiscoveryLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const searchGeneration = useRef(0);
  const activeVideoId = usePlayerState((state) => state.queue[state.index]?.videoId);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const runSearch = useCallback(async (query: string, selectedFilter?: string) => {
    const trimmed = query.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    const generation = ++searchGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const response = await search(trimmed, selectedFilter);
      if (generation !== searchGeneration.current) return;
      setSections(response.sections);
      const nextHistory = await recordSearchQuery(trimmed);
      if (generation === searchGeneration.current) setHistory(nextHistory);
    } catch (caught) {
      if (generation !== searchGeneration.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (generation === searchGeneration.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const [savedHistory, recent] = await Promise.all([
          getSearchHistory(),
          ensureRecentlyPlayedLoaded(),
        ]);
        if (cancelled) return;
        const localItems = recent.map(recentToParsedItem);
        const day = localDayKey(new Date());
        setHistory(savedHistory);
        setDailyItems(selectDailyRecommendations(localItems, day));
        setDiscoveryLoaded(true);

        try {
          const response = await home();
          if (cancelled) return;
          const feedItems = response.sections.flatMap((section) =>
            section.items.filter(
              (item) =>
                (item.type === 'song' || item.type === 'video') && Boolean(item.videoId),
            ),
          );
          setDailyItems(selectDailyRecommendations([...feedItems, ...localItems], day));
        } catch {
          // Keep the already-rendered local daily selection.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (q.trim().length >= 2) {
        void runSearch(q, filter);
      } else {
        searchGeneration.current++;
        setSections(null);
        setError(null);
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timeout);
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

  const useHistoryQuery = useCallback((query: string) => {
    setQ(query);
    inputRef.current?.focus();
  }, []);

  const removeHistoryQuery = useCallback(async (query: string) => {
    setHistory(await deleteSearchQuery(query));
  }, []);

  const clearHistory = useCallback(async () => {
    await clearSearchHistory();
    setHistory([]);
  }, []);

  const results: ParsedItem[] = [];
  let topResult: ParsedItem | null = null;
  for (const s of sections ?? []) {
    if (!topResult && s.title === 'Top result' && s.items.length) {
      // Hoist the top result into its own hero slot above the list. Drop it
      // from the rest of the feed so the song does not appear twice (once in
      // the hero and once in the song list).
      topResult = s.items[0];
      continue;
    }
    for (const it of s.items) if (it.type === 'song' || it.type === 'video') results.push(it);
  }
  const others: ParsedSection[] = (sections ?? [])
    .filter((s) => !(s.title === 'Top result' && s.items.length))
    .filter((s) => s.items.length && s.items[0].type !== 'song' && s.items[0].type !== 'video');

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
                searchGeneration.current++;
                setQ('');
                setSections(null);
                setError(null);
                setLoading(false);
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
        style={styles.chipsViewport}
        contentContainerStyle={styles.chips}
      >
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.label}
              onPress={() => setFilter(f.id)}
              hitSlop={{ top: 6, bottom: 6 }}
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
        <SearchDiscoveryPanel
          history={history}
          dailyItems={dailyItems}
          loaded={discoveryLoaded}
          palette={palette}
          onUseHistory={useHistoryQuery}
          onRemoveHistory={removeHistoryQuery}
          onClearHistory={clearHistory}
          onPlay={onPlay}
          onAddToQueue={addItemToQueue}
          activeVideoId={activeVideoId}
        />
      ) : (
        <FlatList
          data={results.slice(0, 30)}
          keyExtractor={(it, i) => `${it.videoId ?? it.title}-${i}`}
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
            topResult || others.length ? (
              <View>
                {topResult ? (
                  <SearchTopResultCard item={topResult} onOpen={onOpen} palette={palette} />
                ) : null}
                {others.length ? (
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
                ) : null}
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


function recentToParsedItem(item: RecentlyPlayed): ParsedItem {
  return {
    type: 'song',
    title: item.title,
    subtitle: item.artist,
    artists: item.artist ? [{ name: item.artist }] : undefined,
    thumbnail: item.thumbnail,
    videoId: item.videoId,
  };
}

function SearchDiscoveryPanel({
  history,
  dailyItems,
  loaded,
  palette,
  onUseHistory,
  onRemoveHistory,
  onClearHistory,
  onPlay,
  onAddToQueue,
  activeVideoId,
}: {
  history: SearchHistoryEntry[];
  dailyItems: ParsedItem[];
  loaded: boolean;
  palette: Palette;
  onUseHistory: (query: string) => void;
  onRemoveHistory: (query: string) => void;
  onClearHistory: () => void;
  onPlay: (item: ParsedItem) => void;
  onAddToQueue: (item: ParsedItem, placement: 'next' | 'end') => void;
  activeVideoId?: string;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.discoveryContent}
    >
      {history.length > 0 ? (
        <View style={styles.discoverySection}>
          <View style={styles.discoveryHeadingRow}>
            <View style={styles.discoveryHeadingCopy}>
              <Text style={[styles.discoveryTitle, { color: palette.text }]}>Pencarian terbaru</Text>
              <Text style={[styles.discoverySubtitle, { color: palette.textSecondary }]}>
                Tersimpan hanya di perangkat ini
              </Text>
            </View>
            <Pressable
              onPress={onClearHistory}
              accessibilityRole="button"
              accessibilityLabel="Hapus semua riwayat pencarian"
              style={({ pressed }) => [styles.clearAll, pressed && styles.pressed]}
            >
              <Text style={[styles.clearAllLabel, { color: palette.accentText }]}>Hapus semua</Text>
            </Pressable>
          </View>
          <View style={styles.historyList}>
            {history.map((entry) => (
              <View key={entry.query.toLowerCase()} style={styles.historyRow}>
                <Pressable
                  onPress={() => onUseHistory(entry.query)}
                  accessibilityRole="button"
                  accessibilityLabel={`Cari ${entry.query}`}
                  style={({ pressed }) => [styles.historyQuery, pressed && styles.pressed]}
                >
                  <Icon name="history" size={20} color={palette.textSecondary} />
                  <Text numberOfLines={1} style={[styles.historyText, { color: palette.text }]}>
                    {entry.query}
                  </Text>
                  <Icon name="north-west" size={18} color={palette.textSecondary} />
                </Pressable>
                <IconButton
                  name="close"
                  size={18}
                  color={palette.textSecondary}
                  onPress={() => void onRemoveHistory(entry.query)}
                  accessibilityLabel={`Hapus ${entry.query} dari riwayat`}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {dailyItems.length > 0 ? (
        <View style={styles.discoverySection}>
          <View style={styles.discoveryHeadingCopy}>
            <Text style={[styles.discoveryTitle, { color: palette.text }]}>Untukmu hari ini</Text>
            <Text style={[styles.discoverySubtitle, { color: palette.textSecondary }]}>
              Dipilih dari kebiasaan dengarmu • diperbarui setiap hari
            </Text>
          </View>
          <View style={[styles.dailyList, { backgroundColor: palette.surface }]}>
            {dailyItems.map((item) => (
              <SongRow
                key={item.videoId}
                item={item}
                onPlay={onPlay}
                onAddToQueue={onAddToQueue}
                palette={palette}
                active={item.videoId === activeVideoId}
              />
            ))}
          </View>
        </View>
      ) : loaded ? (
        <View style={styles.discoveryEmpty}>
          <View style={[styles.discoveryIcon, { backgroundColor: palette.surfaceVariant }]}>
            <Icon name="music-note" size={30} color={palette.accentText} />
          </View>
          <Text style={[styles.discoveryTitle, { color: palette.text }]}>Temukan musik baru</Text>
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            Cari atau putar beberapa lagu. Pilihan harian akan muncul dari kebiasaan dengarmu.
          </Text>
        </View>
      ) : (
        <View style={styles.discoveryEmpty} accessibilityLabel="Menyiapkan rekomendasi harian">
          <ActivityIndicator color={palette.accent} />
        </View>
      )}
    </ScrollView>
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
  chipsViewport: { height: 52 },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: typeScale.label, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  errText: { fontSize: typeScale.body, textAlign: 'center' },
  hint: { fontSize: typeScale.body, textAlign: 'center' },
  othersTitle: { fontSize: typeScale.title, fontWeight: '700', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  shelfContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
  discoveryContent: { paddingBottom: 180, paddingTop: spacing.md, gap: spacing.xxl },
  discoverySection: { gap: spacing.md },
  discoveryHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  discoveryHeadingCopy: { flex: 1, paddingHorizontal: spacing.lg },
  discoveryTitle: { fontSize: typeScale.titleLarge, fontWeight: '800', letterSpacing: -0.2 },
  discoverySubtitle: { fontSize: typeScale.label, lineHeight: 18, marginTop: 2 },
  clearAll: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm },
  clearAllLabel: { fontSize: typeScale.label, fontWeight: '700' },
  historyList: { paddingHorizontal: spacing.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  historyQuery: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.sm,
  },
  historyText: { flex: 1, fontSize: typeScale.body, fontWeight: '600' },
  dailyList: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingVertical: spacing.xs,
  },
  discoveryEmpty: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  discoveryIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.6 },
});
