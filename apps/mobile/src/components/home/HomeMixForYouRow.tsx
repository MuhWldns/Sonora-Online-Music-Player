/**
 * Home "Mix for you" row. Renders algorithmic mix playlists:
 * 1. If YouTube cookie is present, extracts algorithmic mix playlists from /home shelves
 *    matching mix keywords ("Mixed for you", "Campuran untuk Anda", "Mix", "Supermix").
 * 2. Fallback: generates automix playlist items (track mixes & artist radios) from
 *    recent listening history (getRecentlyPlayed()).
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { getCookie, home } from '../../api/client';
import type { ParsedItem } from '../../api/types';
import { SectionHeader } from '../Icon';
import { ShelfCard } from '../TrackRow';
import type { RootStackParamList } from '../../navigation/types';
import { ensureLoaded, subscribeRecentlyPlayed } from '../../storage/recentlyPlayed';
import { spacing } from '../../theme';
import type { Palette } from '../../theme';
import { buildAutomixPlaylists, extractMixPlaylists } from './mixPlaylists';

export function HomeMixForYouRow({ palette }: { palette: Palette }) {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const loadFallback = useCallback(async () => {
    const recent = await ensureLoaded();
    setItems(buildAutomixPlaylists(recent));
  }, []);

  // Re-check on focus
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        let cookie: string | null = null;
        try {
          cookie = await getCookie();
        } catch {
          cookie = null;
        }

        if (cookie) {
          try {
            const { sections } = await home();
            if (cancelled) return;
            const mixPlaylists = extractMixPlaylists(sections);
            if (mixPlaylists.length > 0) {
              setItems(mixPlaylists);
              return;
            }
          } catch {
            // fall back
          }
        }

        if (cancelled) return;
        const recent = await ensureLoaded();
        if (cancelled) return;
        setItems(buildAutomixPlaylists(recent));
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Subscribe to local history changes (for automix fallback when no cookie)
  useEffect(() => {
    return subscribeRecentlyPlayed((recent) => {
      void getCookie().then((c) => {
        if (!c) {
          setItems(buildAutomixPlaylists(recent));
        }
      });
    });
  }, []);

  const onOpen = useCallback(
    (item: ParsedItem) => {
      const id = item.playlistId ?? item.browseId;
      if (id) {
        navigation.navigate('Browse', { id, title: item.title });
      }
    },
    [navigation],
  );

  if (items.length === 0) return null;

  return (
    <View style={styles.block}>
      <SectionHeader title="Mix for you" palette={palette} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((item, i) => (
          <ShelfCard
            key={`${item.playlistId ?? item.browseId ?? item.title}-${i}`}
            item={item}
            onOpen={onOpen}
            palette={palette}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.lg },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
});
