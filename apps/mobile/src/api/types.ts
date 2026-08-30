/**
 * Types matching proxy response shapes (packages/proxy/src/parsers.ts).
 * Keep in sync with the proxy contract.
 */

export interface ParsedPerson {
  name: string;
  browseId?: string;
}

export interface ParsedItem {
  type: string;
  title: string;
  subtitle?: string;
  thumbnail: string | null;
  artists?: ParsedPerson[];
  album?: ParsedPerson | null;
  duration?: string;
  videoId?: string;
  playlistId?: string;
  browseId?: string;
  browseType?: string;
  watchPlaylist?: boolean;
}

export interface ParsedSection {
  title: string;
  items: ParsedItem[];
  list?: boolean;
}

export interface SearchResponse {
  sections: ParsedSection[];
}

export interface HomeResponse {
  sections: ParsedSection[];
}

export interface QueueItem {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string | null;
  selected: boolean;
}

export interface NextResponse {
  queue: QueueItem[];
}

export interface PlayerResponse {
  videoId: string;
  url: string;
  mimeType: string;
  bitrate: number;
  audioQuality: string;
  title: string;
  artist: string;
  durationMs: number;
}
