/**
 * Type deklarasi env untuk Cloudflare Workers.
 * Digenerate `npx wrangler types` setelah binding final; ini versi manual
 * supaya typecheck jalan sebelum KV namespace dibuat.
 */
export interface Env {
  CACHE?: KVNamespace;
}
