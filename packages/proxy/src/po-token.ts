export interface PoTokenProvider {
  getToken(videoId: string): Promise<string>;
}

interface TokenEntry {
  token: string;
  expiresAt: number;
}

export class CachedPoTokenProvider implements PoTokenProvider {
  private readonly cache = new Map<string, TokenEntry>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private readonly mint: (videoId: string) => Promise<string>,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(videoId: string): Promise<string> {
    const cached = this.cache.get(videoId);
    if (cached && cached.expiresAt > this.now()) return cached.token;

    const inFlight = this.pending.get(videoId);
    if (inFlight) return inFlight;

    const request = this.mint(videoId)
      .then((token) => {
        this.cache.set(videoId, { token, expiresAt: this.now() + this.ttlMs });
        return token;
      })
      .finally(() => this.pending.delete(videoId));
    this.pending.set(videoId, request);
    return request;
  }
}
