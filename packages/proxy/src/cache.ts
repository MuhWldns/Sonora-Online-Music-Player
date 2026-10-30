/**
 * Cache abstraction — satu interface, dua adapter:
 * - MemoryCache (VPS): Map + TTL, hidup selama proses
 * - KVCache (Workers): Cloudflare KV, di-pass dari server/worker.ts
 *
 * Kontrak portabilitas: kode route TIDAK BOLEH import adapter langsung,
 * hanya bergantung pada interface ini via deps.createApp().
 */
export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  /**
   * Hapus entry (untuk invalidation tertarget setelah mutasi, mis. lagu
   * history yang dihapus jangan ikut terlayani dari cache basi).
   *
   * Kenapa opsional: adapter yang tidak punya operasi hapus murah (mis. KV
   * di worker.ts) boleh tidak mengimplementasikannya. Pemanggil WAJIB memakai
   * optional-chaining `deps.cache.delete?.(key)` dan memperlakukan hasilnya
   * sebagai best-effort — cache basi tetap bisa terjadi, bukan error.
   */
  delete?(key: string): Promise<void>;
}

interface Entry {
  value: unknown;
  expires: number;
}

export class MemoryCache implements CacheAdapter {
  private store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
