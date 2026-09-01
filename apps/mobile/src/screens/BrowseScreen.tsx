import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { browse } from '../api/client';
import type { ParsedItem, ParsedSection } from '../api/types';
import { Icon, IconButton, SectionHeader } from '../components/Icon';
import { ShelfCard, SongRow } from '../components/TrackRow';
import { browseTargetOf } from '../navigation/browseTarget';
import type { RootStackParamList } from '../navigation/types';
import { playSong } from '../player/service';
import { usePlayerState } from '../player/usePlayerState';
import { spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Browse'> & { palette: Palette };
type Row = { kind: 'songs' | 'shelf'; section: ParsedSection };

export function BrowseScreen({ navigation, route, palette }: Props) {
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeVideoId = usePlayerState((s) => s.queue[s.index]?.videoId);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const response = await browse(route.params.id);
      setSections(response.sections);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback(
    (item: ParsedItem) => {
      const id = browseTargetOf(item);
      if (id) navigation.push('Browse', { id, title: item.title });
    },
    [navigation],
  );

  if (!sections && !error)
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );

  const rows: Row[] = (sections ?? [])
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      kind:
        section.items[0].type === 'song' || section.items[0].type === 'video'
          ? 'songs'
          : 'shelf',
      section,
    }));

  const renderItem = ({ item }: ListRenderItemInfo<Row>) => {
    if (item.kind === 'shelf')
      return (
        <View style={styles.block}>
          <SectionHeader title={item.section.title} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {item.section.items.map((entry, index) => (
              <ShelfCard key={`${entry.title}-${index}`} item={entry} onOpen={open} palette={palette} />
            ))}
          </ScrollView>
        </View>
      );
    return (
      <View style={styles.block}>
        <SectionHeader title={item.section.title} />
        {item.section.items.map((entry, index) => (
          <SongRow
            key={`${entry.videoId ?? entry.title}-${index}`}
            item={entry}
            onPlay={(song) => playSong(song).catch(() => {})}
            palette={palette}
            active={entry.videoId === activeVideoId}
          />
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: palette.outline }]}>
        <IconButton
          name="arrow-back"
          size={24}
          color={palette.text}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Kembali"
        />
        <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
          {route.params.title}
        </Text>
      </View>
      {error && !sections ? (
        <View style={styles.center}>
          <Icon name="cloud-off" size={40} color={palette.textSecondary} />
          <Text style={[styles.error, { color: palette.textSecondary }]}>{error}</Text>
          <Pressable onPress={load} style={[styles.retry, { backgroundColor: palette.accent }]}>
            <Text style={[styles.retryText, { color: palette.onAccent }]}>Coba lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row, index) => `${row.section.title}-${index}`}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 180 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: typeScale.title, fontWeight: '700', marginHorizontal: spacing.sm },
  block: { marginTop: spacing.lg },
  shelf: { paddingHorizontal: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  error: { fontSize: typeScale.body, textAlign: 'center' },
  retry: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 24 },
  retryText: { fontSize: typeScale.body, fontWeight: '700' },
});
