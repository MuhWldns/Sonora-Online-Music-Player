# Sonora Music — Agent Guide

Panduan untuk AI agent yang bekerja di repo ini. Baca dulu sebelum mengubah apa pun.

## Konteks project

Sonora = music player pribadi berbasis YouTube Music dengan UI custom.

Arsitektur client-server:

```
apps/mobile (Expo RN, UI custom)
   │  JSON via fetch — cookie YouTube dikirim per-request header x-yt-cookie
   │  audio: fetch langsung dari googlevideo; fallback /stream (relay via proxy)
   ▼
packages/proxy (Hono, portable)
   ├── src/        ← SEMUA logic endpoint (runtime-agnostic, web-standard API saja)
   ├── server/     ← entrypoint: node.ts (VPS) / worker.ts (Cloudflare)
   └── parsers.ts  ← raw InnerTube JSON → JSON bersih (jangan pakai node-class youtubei.js)
```

## Aturan penting

1. **Portabilitas proxy**: tidak ada API Node langsung di `src/` (hanya `fetch`/`Headers`/`Response` web-standard). `Innertube` constructor di-inject dari entrypoint (DI), bukan di-import di `src/`.
2. **Data feed = raw JSON + parser sendiri** (`parsers.ts`). Node-class youtubei.js v18 (SuperParsedResult) terbukti tidak stabil — jangan migrate balik.
3. **youtubei.js v18 butuh `Platform.shim.eval`** (custom JS evaluator) untuk decipher stream URL. Di-set di `server/node.ts` (Function constructor) dan `server/worker.ts` (+ flag `unsafe_eval` di wrangler.jsonc).
4. **Server stateless**: cookie akun TIDAK PERNAH disimpan server — hanya header per-request. Jangan tambahkan persistence cookie.
5. **googlevideo 403 tanpa `Range` + browser `User-Agent`** — sudah ditangani `/stream`. Jangan ubah header itu.
6. **VPS pakai NAT**: app jalan di port internal (3030 untuk proxy), akses luar via port publik 45.198.149.134:2310. Jangan bind port publik di dalam konfigurasi.

## Commands

```bash
# root (npm workspaces; pnpm RUSAK di mesin dev — pakai npm)
npm install
npm run proxy:dev          # proxy dev server localhost:3000
npm run proxy:typecheck

# proxy (packages/proxy)
npm run build              # tsc → dist/
npm run check:cf           # wrangler dry-run (validasi bundle Workers)

# mobile (apps/mobile)
npx expo start             # metro dev server
npx tsc --noEmit           # typecheck
```

## CI/CD

- **CI** (tiap push/PR): typecheck proxy + app + workers dry-run.
- **Deploy Proxy** (push main menyentuh `packages/proxy/**`):
  1. Docker build (context REPO ROOT — lockfile & workspace di root) → push GHCR `ghcr.io/muhwldns/sonora-online-music-player/proxy`
  2. SSH ke VPS (port 2104) → `/sonora/docker-compose.yml` → `compose pull && up -d`
  3. Job deploy aktif jika repo variable `VPS_HOST` terisi; secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
- **Live**: http://45.198.149.134:2310 (NAT → internal 3030 → container 3000)

## Known quirks (hasil PoC — jangan "perbaiki" tanpa alasan)

- XFF tidak mengubah binding `ip=` stream URL (WEB_REMIX mengabaikan) → itu alasan `/stream` ada.
- `/player` beruntun dalam waktu singkat bisa kena throttle googlevideo sementara.
- Filter search pakai params protobuf base64 hardcoded di `src/index.ts` (FILTER_PARAMS).
- Search layout modern: `musicCardShelfRenderer` + flat `itemSectionRenderer` (fallback parser menangani keduanya).

## Workflow agent

- Commit granular per logika perubahan; conventional commits (`feat:`, `fix:`, `docs:`, `ci:`).
- Setelah selesai fase: update README.md (root) + AGENTS.md ini agar tetap sinkron.
- Deploy otomatis via push — jangan SSH manual ke VPS untuk update kode kecuali pipeline rusak.
- Smoke test produksi: `curl http://45.198.149.134:2310/healthz`
