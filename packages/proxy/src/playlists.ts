import { findAll } from './parsers.js';

export interface PlaylistLibraryState {
  id: string;
  saved: boolean;
}

const PLAYLIST_ID_RE = /^(?:PL|RD|OLAK5uy_|UU|LL|FL|WL|UL|PU|TL|LM)[A-Za-z0-9_-]+$/;
const MAX_PLAYLIST_TITLE_LENGTH = 150;

export function canonicalPlaylistId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let id = value.trim();
  if (id.startsWith('VL')) id = id.slice(2);
  return PLAYLIST_ID_RE.test(id) ? id : null;
}

export function normalizePlaylistTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  const length = [...title].length;
  if (length < 1 || length > MAX_PLAYLIST_TITLE_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(title)) return null;
  return title;
}

function targetPlaylistId(target: unknown): string | null {
  if (typeof target === 'string') return canonicalPlaylistId(target);
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const record = target as Record<string, unknown>;
  return canonicalPlaylistId(record.playlistId ?? record.browseId);
}

interface LikeEndpoint {
  status?: unknown;
  target?: unknown;
}

interface ToggleButtonRenderer {
  isToggled?: unknown;
}

/**
 * Extract the account's playlist-library state from the raw browse header.
 * A boolean is returned only when one toggle owns both LIKE and INDIFFERENT
 * endpoints for the requested playlist. Video-like buttons and unrelated
 * nested playlist cards are ignored.
 */
export function parsePlaylistLibraryState(
  data: unknown,
  requestedId: string,
): PlaylistLibraryState | undefined {
  const expectedId = canonicalPlaylistId(requestedId);
  if (!expectedId) return undefined;

  const headers = [
    ...findAll<unknown>(data, 'musicDetailHeaderRenderer'),
    ...findAll<unknown>(data, 'musicResponsiveHeaderRenderer'),
    ...findAll<unknown>(data, 'musicEditablePlaylistDetailHeaderRenderer'),
  ];
  for (const header of headers) {
    for (const toggle of findAll<ToggleButtonRenderer>(header, 'toggleButtonRenderer')) {
      if (typeof toggle.isToggled !== 'boolean') continue;
      const endpoints = findAll<LikeEndpoint>(toggle, 'likeEndpoint');
      let hasSave = false;
      let hasRemove = false;

      for (const endpoint of endpoints) {
        if (targetPlaylistId(endpoint.target) !== expectedId) continue;
        if (endpoint.status === 'LIKE') hasSave = true;
        if (endpoint.status === 'INDIFFERENT') hasRemove = true;
      }

      if (hasSave && hasRemove) {
        return { id: expectedId, saved: toggle.isToggled };
      }
    }
  }

  return undefined;
}
