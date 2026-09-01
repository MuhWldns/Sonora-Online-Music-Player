const RELAY_CHUNK_SIZE = 1024 * 1024;
const OPEN_RANGE_RE = /^bytes=(\d+)-$/i;
const BOUNDED_RANGE_RE = /^bytes=\d+-\d+$/i;

export function upstreamRangeFor(
  clientRange: string | undefined,
  streamUnlocked = false,
): string {
  if (clientRange && BOUNDED_RANGE_RE.test(clientRange)) return clientRange;

  const start = clientRange?.match(OPEN_RANGE_RE)?.[1];
  const firstByte = start ? Number(start) : 0;
  if (streamUnlocked) return `bytes=${firstByte}-`;
  return `bytes=${firstByte}-${firstByte + RELAY_CHUNK_SIZE - 1}`;
}
