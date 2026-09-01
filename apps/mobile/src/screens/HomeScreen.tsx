/**
 * Home: personalized feed. Large greeting header, horizontal shelves for
 * album/playlist/artist content, song lists inline. Canon streaming layout.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ListRenderItemInfo,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, SectionHeader } from '../components/Icon';
import { ShelfCard, SongRow } from '../components/TrackRow';
import { home } from '../api/client';
import type { ParsedItem, ParsedSection } from '../api/types';
import { usePlayerState } from '../player/usePlayerState';
import { browseTargetOf } from '../navigation/browseTarget';
import type { RootStackParamList } from '../navigation/types';
import { playSong } from '../player/service';
import { spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

type Row =
  | { kind: 'header' }
  | { kind: 'shelf'; section: ParsedSection }
  | { kind: 'songs'; section: ParsedSection };

function toRows(sections: ParsedSection[]): Row[] {
  const rows: Row[] = [{ kind: 'header' }];
  for (const section of sections) {
    if (!section.items.length) continue;
    // Song-ish lists render vertically; other types become a horizontal shelf.
    const songish =
      section.items[0].type === 'song' || section.items[0].type === 'video';
    rows.push(songish ? { kind: 'songs', section } : { kind: 'shelf', section });
  }
  return rows;
}

export function HomeScreen({ palette }: { palette: Palette }) {
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activeVideoId = usePlayerState((s) => s.queue[s.index]?.videoId);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const { sections: s } = await home();
      setSections(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  if (!sections && !error)
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );

  if (error && !sections)
    return (
      <View style={[styles.center, { backgroundColor: palette.background, paddingTop: insets.top }]}>
        <Icon name="cloud-off" size={40} color={palette.textSecondary} />
        <Text style={[styles.errTitle, { color: palette.text }]}>Tidak bisa memuat</Text>
        <Text style={[styles.errBody, { color: palette.textSecondary }]}>{error}</Text>
        <Pressable onPress={load} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }, { backgroundColor: palette.accent }]}>
          <Text style={[styles.retryText, { color: palette.onAccent }]}>Coba lagi</Text>
        </Pressable>
      </View>
    );

  const rows = toRows(sections ?? []);

  const renderItem = ({ item }: ListRenderItemInfo<Row>) => {
    if (item.kind === 'header')
      return (
        <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          <Text style={[styles.greeting, { color: palette.text }]}>Sonora</Text>
        </View>
      );
    if (item.kind === 'shelf')
      return (
        <View style={styles.shelfBlock}>
          <SectionHeader title={item.section.title} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.shelfContent}
          >
            {item.section.items.map((it, i) => (
              <ShelfCard key={`${it.title}-${i}`} item={it} onOpen={onOpen} palette={palette} />
            ))}
          </ScrollView>
        </View>
      );
    return (
      <View style={styles.songsBlock}>
        <SectionHeader title={item.section.title} />
        {item.section.items.slice(0, 6).map((it, i) => (
          <SongRow
            key={`${it.videoId ?? it.title}-${i}`}
            item={it}
            onPlay={onPlay}
            palette={palette}
            active={it.videoId === activeVideoId}
          />
        ))}
      </View>
    );
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(row, i) => (row.kind === 'shelf' || row.kind === 'songs' ? `${row.section.title}-${i}` : 'header')}
      renderItem={renderItem}
      contentContainerStyle={{ paddingBottom: 180 }}
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
      style={{ backgroundColor: palette.background }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  greeting: { fontSize: typeScale.display, fontWeight: '800', letterSpacing: -0.5 },
  shelfBlock: { marginTop: spacing.lg },
  shelfContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
  songsBlock: { marginTop: spacing.lg },
  errTitle: { fontSize: typeScale.titleLarge, fontWeight: '700' },
  errBody: { fontSize: typeScale.body, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 24 },
  retryText: { fontSize: typeScale.body, fontWeight: '700' },
});
