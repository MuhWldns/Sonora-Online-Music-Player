import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
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

import { browse, setPlaylistSaved } from '../api/client';
import type { ParsedItem, ParsedSection, PlaylistLibraryState } from '../api/types';
import { Icon, IconButton, SectionHeader } from '../components/Icon';
import { ShelfCard, SongRow } from '../components/TrackRow';
import { browseTargetOf } from '../navigation/browseTarget';
import type { RootStackParamList } from '../navigation/types';
import { addItemToQueue, playSong } from '../player/service';
import { usePlayerState } from '../player/usePlayerState';
import { spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Browse'> & { palette: Palette };
type Row = { kind: 'songs' | 'shelf'; section: ParsedSection };

export function BrowseScreen({ navigation, route, palette }: Props) {
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistLibraryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activeVideoId = usePlayerState((s) => s.queue[s.index]?.videoId);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const response = await browse(route.params.id);
      setSections(response.sections);
      setPlaylist(response.playlist ?? null);
      setError(null);
      setSaveError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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

  const toggleSaved = useCallback(async () => {
    if (!playlist || saving) return;
    const nextSaved = !playlist.saved;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await setPlaylistSaved(playlist.id, nextSaved);
      setPlaylist(result);
      AccessibilityInfo.announceForAccessibility(
        result.saved ? 'Playlist disimpan ke library' : 'Playlist dihapus dari library',
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSaveError(
        message.startsWith('proxy 401')
          ? 'Login diperlukan. Perbarui cookie akun di Settings.'
          : 'Perubahan belum tersimpan. Coba lagi.',
      );
    } finally {
      setSaving(false);
    }
  }, [playlist, saving]);

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
          <SectionHeader title={item.section.title} palette={palette} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {item.section.items.map((entry, index) => (
              <ShelfCard key={`${entry.title}-${index}`} item={entry} onOpen={open} palette={palette} />
            ))}
          </ScrollView>
        </View>
      );
    return (
      <View style={styles.block}>
        <SectionHeader title={item.section.title} palette={palette} />
        {item.section.items.map((entry, index) => (
          <SongRow
            key={`${entry.videoId ?? entry.title}-${index}`}
            item={entry}
            onPlay={(song) => playSong(song).catch(() => {})}
            onAddToQueue={addItemToQueue}
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
        {playlist ? (
          <Pressable
            onPress={toggleSaved}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={playlist.saved ? 'Hapus playlist dari library' : 'Simpan playlist ke library'}
            accessibilityState={{ selected: playlist.saved, busy: saving, disabled: saving }}
            style={({ pressed }) => [
              styles.saveButton,
              {
                backgroundColor: playlist.saved ? palette.surfaceVariant : palette.accent,
                borderColor: playlist.saved ? palette.outline : palette.accent,
              },
              pressed && styles.pressed,
              saving && styles.disabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator
                size="small"
                color={playlist.saved ? palette.accentText : palette.onAccent}
              />
            ) : (
              <Icon
                name={playlist.saved ? 'library-add-check' : 'library-add'}
                size={18}
                color={playlist.saved ? palette.accentText : palette.onAccent}
              />
            )}
            <Text
              style={[
                styles.saveLabel,
                { color: playlist.saved ? palette.accentText : palette.onAccent },
              ]}
            >
              {playlist.saved ? 'Tersimpan' : 'Simpan'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {saveError ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.saveError, { backgroundColor: palette.surfaceVariant }]}
        >
          <Icon name="info-outline" size={18} color={palette.error} />
          <Text style={[styles.saveErrorText, { color: palette.error }]}>{saveError}</Text>
        </View>
      ) : null}
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
  saveButton: {
    minHeight: 40,
    minWidth: 104,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  saveLabel: { fontSize: typeScale.label, fontWeight: '700' },
  saveError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
  },
  saveErrorText: { flex: 1, fontSize: typeScale.label, lineHeight: 18 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  block: { marginTop: spacing.lg },
  shelf: { paddingHorizontal: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  error: { fontSize: typeScale.body, textAlign: 'center' },
  retry: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 24 },
  retryText: { fontSize: typeScale.body, fontWeight: '700' },
});
