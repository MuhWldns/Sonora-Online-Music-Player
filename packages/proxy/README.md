# Sonora Music — Proxy

Proxy InnerTube (YouTube Music) untuk app Sonora (React Native). **Satu codebase, dua target deploy**: Node (VPS/Docker, utama) dan Cloudflare Workers (opsi instan).

## Arsitektur

```
┌─ App RN ─────────────┐        ┌─ packages/proxy ──────────────────┐
│ cookie di Keychain   │  JSON  │ src/index.ts   (Hono, murni)      │
│ track-player         │◀──────▶│ src/parsers.ts (raw-JSON parser)  │
│ fetch audio: ─────────┼──┐     │ src/innertube.ts(DI + XFF)        │
└──────────────────────┘  │     │ src/cache.ts   (CacheAdapter)     │
                          │     └───────────────────────────────────┘
                          │         entrypoint Node / Workers (satu-satunya beda)
                          ▼
              googlevideo.com (audio, di-fetch player langsung;
              kalau 403 → fallback /stream relay lewat server)
```

Pembagian kerja internal (hasil PoC):

- **Data feed** (`/search` `/home` `/next` `/browse` `/library`): raw InnerTube JSON via `actions.execute` + parser sendiri (`parsers.ts`) — tidak bergantung node-class youtubei.js yang churn antar versi.
- **Playback** (`/player` `/stream`): youtubei.js `TrackInfo` + decipher (butuh JS evaluator — diset di masing-masing entrypoint).

## Kontrak portabilitas

1. Semua logic endpoint di `src/` — dua entrypoint hanya wiring (±15 baris).
2. Tidak ada API Node langsung di `src/` — hanya Web Standard (`fetch`, `Headers`, `Response`).
3. `Innertube` constructor di-inject dari entrypoint: `youtubei.js` (Node) vs `youtubei.js/cf-worker` (Workers).
4. Cookie dikirim app per-request via header `x-yt-cookie` — server stateless, tidak menyimpan kredensial.

## Endpoints

| Endpoint | Query | Keterangan |
|---|---|---|
| `GET /healthz` | — | liveness |
| `GET /search` | `q`, `filter=song\|video\|album\|artist\|playlist` | cache 10 menit |
| `GET /home` | — | cache 5 menit; key personal vs anon terpisah |
| `GET /library` | — | **401 tanpa** `x-yt-cookie` |
| `GET /browse` | `id` | album/artist/playlist detail |
| `GET /next` | `videoId` | radio queue (50 item) |
| `GET /player` | `videoId` | URL stream deciphered (metadata + bitrate + mime) |
| `GET /stream` | `videoId` | **relay fallback** — audio bytes lewat server |

## Dev (lokal, tanpa Docker)

```bash
npm install                # di root monorepo
npm run proxy:dev          # tsx watch, port 3000 (PORT env override)
curl localhost:3000/healthz
curl "localhost:3000/search?q=radwimps&filter=song"
```

## Deploy VPS (Docker, utama)

```bash
cd packages/proxy
docker compose up -d --build   # port 3000
```

Tanpa Docker (Node 22+): `npm run build && npm start`.

Di belakang reverse proxy (nginx/caddy): proxy harus meneruskan `x-forwarded-for`.

## Deploy Cloudflare Workers (opsi instan)

```bash
cd packages/proxy
npx wrangler kv namespace create CACHE   # masukkan id-nya ke wrangler.jsonc
npm run deploy:cf
```

Butuh: `nodejs_compat` + `unsafe_eval` (sudah di `wrangler.jsonc`), plan **Paid** ($5/bln) — parsing InnerTube melebihi CPU 10ms plan Free.

## Catatan risiko (hasil PoC 2026-08)

1. **Binding IP stream URL**: `X-Forwarded-For` diabaikan YouTube untuk binding `ip=` pada client WEB_REMIX — URL dari `/player` terikat IP server. Kalau HP gagal fetch langsung (403), client fallback ke `/stream` (relay, IP pasti cocok).
2. **Rate limit**: googlevideo menolak fetch tanpa `Range` + browser `User-Agent` (403) — sudah ditangani di `/stream`. Request `/player` beruntun dalam waktu singkat bisa kena throttle sementara; pola pakai 1 user personal aman.
3. **PO token**: belum diimplementasi. Kalau YouTube mulai mensyaratkan PO token untuk stream, tambahkan bgutils-js di layer `/player` (satu tempat).
4. **Login**: Google memblokir login dari webview embedded — app RN memakai cookie hasil login browser (export via extension/paste), dikirim per-request `x-yt-cookie`.
