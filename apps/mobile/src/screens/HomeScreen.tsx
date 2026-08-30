/**
 * Minimal Home screen: fetch /home sections, render as flat lists, tap song → play.
 * Placeholder UI — visual design pass comes after playback PoC.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { home } from '../api/client';
import type { ParsedItem, ParsedSection } from '../api/types';
import { playQueue, playSong } from '../player/service';

function SongRow({ item, onPlay }: { item: ParsedItem; onPlay: (i: ParsedItem) => void }) {
  return (
    <Pressable style={styles.row} onPress={() => onPlay(item)} disabled={!item.videoId}>
      <Image
        source={item.thumbnail ? { uri: item.thumbnail } : undefined}
        style={styles.thumb}
      />
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {item.subtitle ?? item.artists?.map((a) => a.name).join(', ')}
        </Text>
      </View>
    </Pressable>
  );
}

export function HomeScreen() {
  const [sections, setSections] = useState<ParsedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    home()
      .then((r) => setSections(r.sections))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const onPlay = useCallback((item: ParsedItem) => {
    playSong(item).catch(() => {});
  }, []);

  if (loading) return <ActivityIndicator style={styles.center} size="large" />;
  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );

  return (
    <FlatList
      data={sections}
      keyExtractor={(s, i) => `${s.title}-${i}`}
      renderItem={({ item: section }) => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.list ? (
            section.items.map((it) => <SongRow key={it.videoId ?? it.title} item={it} onPlay={onPlay} />)
          ) : (
            <FlatList
              horizontal
              data={section.items}
              keyExtractor={(it, i) => `${it.videoId ?? it.browseId ?? it.title}-${i}`}
              renderItem={({ item: it }) => (
                <Pressable style={styles.card} onPress={() => it.videoId && playQueue([it])}>
                  <Image
                    source={it.thumbnail ? { uri: it.thumbnail } : undefined}
                    style={styles.cardThumb}
                  />
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {it.title}
                  </Text>
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {it.subtitle}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', margin: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  thumb: { width: 48, height: 48, borderRadius: 4, backgroundColor: '#ddd' },
  rowText: { flex: 1, marginLeft: 12 },
  title: { fontSize: 15, color: '#111' },
  subtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  card: { width: 140, marginLeft: 12 },
  cardThumb: { width: 140, height: 140, borderRadius: 8, backgroundColor: '#ddd' },
  cardTitle: { fontSize: 13, fontWeight: '600', marginTop: 6, color: '#111' },
  cardSub: { fontSize: 11, color: '#666', marginTop: 2 },
  error: { color: '#b00', paddingHorizontal: 24, textAlign: 'center' },
});
