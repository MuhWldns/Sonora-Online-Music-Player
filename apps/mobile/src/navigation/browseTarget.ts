import type { ParsedItem } from '../api/types';

export function browseTargetOf(item: ParsedItem): string | undefined {
  return item.browseId ?? item.playlistId;
}
