/**
 * Search "Top result" hero card. The proxy emits the top result as the
 * first section of /search responses, with `title === 'Top result'` and a
 * single ParsedItem (song | album | artist | playlist). We render that
 * single item here as a hero above the song list.
 *
 * Tap behavior: navigates to the album/artist/playlist browse page.
 * Never auto-plays, even when the top is a song. Songs get an explicit
 * play button so users can still start playback with one tap.
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, IconButton } from './Icon';
import type { ParsedItem } from '../api/types';
import { playSong } from '../player/service';
import { radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';

export function SearchTopResultCard({
  item,
  onOpen,
  palette,
}: {
  item: ParsedItem;
  onOpen: (item: ParsedItem) => void;
  palette: Palette;
}) {
  const isArtist = item.type === 'artist';
  const subtitle = item.subtitle || item.artists?.map((a) => a.name).join(', ') || '';
  const isSong = item.type === 'song' && Boolean(item.videoId);
  const thumbStyle = isArtist ? styles.thumbCircle : styles.thumbSquare;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>Top result</Text>
      <Pressable
        onPress={() => onOpen(item)}
        accessibilityRole="button"
        accessibilityLabel={`Buka ${item.title}`}
        accessibilityHint="Tap untuk membuka halaman detail"
        style={({ pressed }) => [styles.card, { backgroundColor: palette.surface }, pressed && { opacity: 0.85 }]}
      >
        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail }} style={[thumbStyle, { backgroundColor: palette.surfaceVariant }]} />
        ) : (
          <View style={[thumbStyle, styles.thumbFallback, { backgroundColor: palette.surfaceVariant }]}>
            <Icon name="album" size={48} color={palette.textSecondary} />
          </View>
        )}
        <View style={styles.meta}>
          <Text numberOfLines={2} style={[styles.title, { color: palette.text }]}>
            {item.title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={[styles.subtitle, { color: palette.textSecondary }]}>
              {subtitle}
            </Text>
          ) : null}
          <View style={[styles.typeBadge, { backgroundColor: palette.accent }]}>
            <Text style={[styles.typeBadgeText, { color: palette.onAccent }]}>{labelFor(item)}</Text>
          </View>
        </View>
      </Pressable>
      {isSong ? (
        <IconButton
          name="play-circle"
          size={36}
          color={palette.accent}
          onPress={() =>
            playSong(item).catch(() => {})
          }
          accessibilityLabel={`Putar ${item.title}`}
        />
      ) : null}
    </View>
  );
}

function labelFor(item: ParsedItem): string {
  switch (item.type) {
    case 'song':
      return 'Lagu';
    case 'video':
      return 'Video';
    case 'album':
      return 'Album';
    case 'artist':
      return 'Artis';
    case 'playlist':
      return 'Playlist';
    default:
      return item.type.charAt(0).toUpperCase() + item.type.slice(1);
  }
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  label: {
    fontSize: typeScale.label,
    fontWeight: '600',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  thumbSquare: { width: 96, height: 96, borderRadius: radius.md },
  thumbCircle: { width: 96, height: 96, borderRadius: 48 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: spacing.xs },
  title: { fontSize: typeScale.title, fontWeight: '700' },
  subtitle: { fontSize: typeScale.body },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  typeBadgeText: { fontSize: typeScale.label, fontWeight: '700' },
});