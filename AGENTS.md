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
   └── parsers.ts  ← raw InnerTube JSON → JSON bersih
```

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

## Workflow agent

- Gunakan commit granular dan pesan yang sesuai isi perubahan.
- Deploy otomatis via push; jangan SSH manual ke VPS.
- Verifikasi tidak ada secret atau endpoint privat yang ikut ter-track sebelum publikasi.
- Untuk dokumentasi publik, gunakan placeholder seperti `https://your-proxy.example.com`.

## Runtime boundary

Node-only integration berada di `packages/proxy/server/`; `packages/proxy/src/` tetap portable.

## Security

Credential yang tertempel di chat atau issue harus dianggap compromised dan segera dirotasi.

## License

MIT
