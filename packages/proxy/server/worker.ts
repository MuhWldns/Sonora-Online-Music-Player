/**
 * Entry Cloudflare Workers.
 * youtubei.js platform build cf-worker (resmi dari youtubei.js 18),
 * cache Cloudflare KV (binding CACHE di wrangler.jsonc).
 *
 * Deploy: npm run deploy:cf  (setelah `wrangler kv namespace create CACHE`)
 */
import type { Env } from '../worker-configuration.d.ts';

import { createApp } from '../src/index.js';
import type { CacheAdapter } from '../src/cache.js';
import { Innertube, Platform } from 'youtubei.js/cf-worker';

// Evaluator untuk decipher — di Workers butuh compatibility_flags
// ["unsafe_eval"] (lihat wrangler.jsonc); Function constructor diperbolehkan.
Platform.shim.eval = async (data) => new Function(data.output)();

class KVCache implements CacheAdapter {
  constructor(private kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    const v = await this.kv.get(key, 'json');
    return (v as T) ?? null;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)),
    });
  }
}

/** Tanpa binding KV (mis. `wrangler dev` pertama kali): cache no-op.
 *  Endpoint tetap jalan, hanya tanpa cache antar-request. */
const NOOP_CACHE: CacheAdapter = {
  async get() {
    return null;
  },
  async set() {},
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp({
      Innertube,
      cache: env.CACHE ? new KVCache(env.CACHE) : NOOP_CACHE,
    });
    return app.fetch(request);
  },
};
