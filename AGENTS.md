# Sonora Music — Agent Guide

Panduan untuk AI agent yang bekerja di repo ini. Baca dulu sebelum mengubah apa pun.

## Konteks project

Sonora = music player pribadi berbasis YouTube Music dengan UI custom.

## Arsitektur client-server

```
apps/mobile (Expo RN, UI custom)
   │ JSON via fetch — cookie YouTube dikirim per-request header x-yt-cookie
   │ audio: /stream relay via proxy yang dikonfigurasi operator
   ▼
packages/proxy (Hono, portable)
   ├── src/        ← logic endpoint runtime-agnostic
   ├── server/     ← entrypoint Node dan Cloudflare Worker
   │   └── po-token-provider.ts ← BotGuard/WebPO provider untuk Node
   └── parsers.ts  ← raw InnerTube JSON → JSON bersih
```

Mobile memiliki `RootNavigator` untuk tab + halaman Browse. Kartu playlist/album/artis dari Home dan Search membuka `/browse`; daftar playlist diparse dari `musicPlaylistShelfRenderer`.

Playback Node memakai BotGuard/WebPO content-bound token melalui `bgutils-js`. Cloudflare Worker hanya adapter eksperimental untuk feed dan bundle compatibility; jangan dokumentasikan atau deploy sebagai backend playback penuh.

Player mobile menggunakan `expo-audio`. Saat mengganti track, player lama harus di-pause, di-remove, dan di-release sebelum player baru dibuat.

Konfigurasi proxy mobile bersifat deployment-neutral: `EXPO_PUBLIC_PROXY_BASE` dibaca saat build, atau URL dapat diisi lewat Settings. Tanpa konfigurasi, app tidak memiliki endpoint default.

## Aturan penting

1. **Portabilitas proxy**: `src/` hanya memakai Web Standard API. `Innertube` di-inject dari entrypoint.
2. **Data feed** memakai raw InnerTube JSON dan parser sendiri (`parsers.ts`).
3. **Playback** membutuhkan `Platform.shim.eval` untuk decipher stream URL.
4. **Server stateless**: cookie akun hanya diteruskan per-request dan tidak disimpan server.
5. **Deployment URL, host, port, IP, dan SSH details adalah konfigurasi operator** — jangan commit ke source atau dokumentasi publik.
6. **Jangan commit cookie YouTube, token, private key, atau file `.env.local`.**

## Commands

```bash
npm install
npm run proxy:dev
npm run proxy:typecheck
npm run build -w @sonora-music/proxy
npm run check:cf -w @sonora-music/proxy

cd apps/mobile
npx expo start
npx tsc --noEmit
```

## CI/CD

CI menjalankan typecheck proxy, typecheck mobile, dan Workers bundle dry-run. Deployment memakai GitHub Secrets milik operator. Detail URL deploy tidak disimpan di repository.

## Public configuration

Salin `.env.example` ke `.env.local`, lalu isi URL proxy milik instance yang kamu kontrol. Alternatifnya, isi URL melalui Settings aplikasi. `.env.local` tidak boleh di-commit.

Untuk build release dengan konfigurasi privat, gunakan env lokal yang tidak di-commit. Nilai env publik yang dipakai saat bundling tetap dapat diekstrak dari APK; jangan memasukkan credential ke env mobile.

## Workflow agent

- Gunakan commit granular dan pesan yang sesuai isi perubahan.
- Deploy otomatis via push; jangan SSH manual ke VPS.
- Verifikasi tidak ada secret atau endpoint privat yang ikut ter-track sebelum publikasi.
- Untuk dokumentasi publik, gunakan placeholder seperti `https://your-proxy.example.com`.

## Runtime boundary

Node-only integration berada di `packages/proxy/server/`; `packages/proxy/src/` tetap portable.

## Security

Credential yang tertempel di chat atau issue harus dianggap compromised dan segera dirotasi.

## Current implementation notes

- `/browse` menangani playlist shelf yang nested di `twoColumnBrowseResultsRenderer`.
- Node proxy memiliki BotGuard/WebPO provider dengan cache token per video dan single-flight minter refresh.
- Cloudflare Worker belum mengaktifkan provider PO-token Node.
- APK release dibangun dari `apps/mobile/android` dan sebaiknya disimpan di luar source repository.

## License

MIT
