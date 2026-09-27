import type { ParsedItem, ParsedSection } from '../../api/types';
import type { RecentlyPlayed } from '../../storage/recentlyPlayed';

const MIX_KEYWORDS = ['mixed for you', 'campuran untuk anda', 'supermix', 'mix'];

export function isMixShelfTitle(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return MIX_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Extract mix playlist items from shelves whose title matches mix keywords
 * (e.g. "Mixed for you", "Campuran untuk Anda", "Mix", "Supermix")
 * where items have type === 'playlist'.
 */
export function extractMixPlaylists(sections: ParsedSection[]): ParsedItem[] {
  const seen = new Set<string>();
  const playlists: ParsedItem[] = [];

  for (const section of sections) {
    if (!isMixShelfTitle(section.title)) continue;
    for (const item of section.items) {
      if (item.type !== 'playlist') continue;
      const id = item.playlistId ?? item.browseId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      playlists.push(item);
    }
  }

  return playlists;
}

/**
 * Generate automix playlist items derived from the user's recent listening history.
 * - For recent tracks (deduped by videoId/title):
 *   title: Mix ${track.title}
 *   subtitle: Radio • Berdasarkan ${track.artist}
 *   thumbnail: track.thumbnail
 *   playlistId: RDAMVM${track.videoId}
 *   type: 'playlist'
 * - For distinct artists in recent history:
 *   title: Radio ${track.artist}
 *   subtitle: Mix artis • Dibuat untuk Anda
 *   thumbnail: track.thumbnail
 *   playlistId: RDAMVM${track.videoId}
 *   type: 'playlist'
 */
export function buildAutomixPlaylists(recent: RecentlyPlayed[]): ParsedItem[] {
  const trackMixes: ParsedItem[] = [];
  const artistRadios: ParsedItem[] = [];
  const seenTracks = new Set<string>();
  const seenArtists = new Set<string>();

  for (const track of recent) {
    if (!track.videoId) continue;

    const vid = track.videoId.trim();
    const titleKey = track.title ? track.title.toLowerCase().trim() : '';
    const hasTrack = seenTracks.has(vid) || (titleKey !== '' && seenTracks.has(titleKey));
    if (!hasTrack) {
      seenTracks.add(vid);
      if (titleKey) seenTracks.add(titleKey);
      trackMixes.push({
        type: 'playlist',
        title: `Mix ${track.title}`,
        subtitle: track.artist ? `Radio • Berdasarkan ${track.artist}` : 'Radio',
        thumbnail: track.thumbnail,
        playlistId: `RDAMVM${track.videoId}`,
      });
    }

    const artistName = track.artist?.trim();
    if (artistName) {
      const artistKey = artistName.toLowerCase();
      if (!seenArtists.has(artistKey)) {
        seenArtists.add(artistKey);
        artistRadios.push({
          type: 'playlist',
          title: `Radio ${artistName}`,
          subtitle: 'Mix artis • Dibuat untuk Anda',
          thumbnail: track.thumbnail,
          playlistId: `RDAMVM${track.videoId}`,
        });
      }
    }
  }

  return [...trackMixes, ...artistRadios];
}
