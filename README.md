# Sonora

**Sonora** is a self-hosted YouTube Music client for people who want full control over their listening experience. It pairs a React Native app with a completely custom UI against a lightweight proxy server that speaks YouTube's internal InnerTube API.

The proxy is portable by design: **the same codebase runs as a Docker container on your own VPS or deploys in seconds to Cloudflare Workers.** Authentication is cookie-based — your account stays yours, credentials never leave your device except per-request, and the server stays fully stateless. Audio streams directly from Google's CDN to the player, with a server-side relay fallback when IP-bound stream URLs reject the client.

> Early stage: the proxy is working and verified; the mobile app is under active development.

## Features

- Search (songs, albums, artists, playlists) via YouTube Music
- Home feed with your account's personalized recommendations
- Library & liked songs from your own account (cookie-authenticated)
- Audio playback with queue/radio (up next) support
- Credentials stored only on your device — server is stateless
- One-command deploy on any VPS via Docker, or instant Cloudflare Workers deploy

## Repository layout

```
├── apps/
│   └── mobile/          # React Native (Expo) app — custom UI client
├── packages/
│   └── proxy/           # InnerTube proxy (Hono + youtubei.js)
│       ├── src/         #   runtime-agnostic app code
│       ├── server/      #   entrypoints: Node (VPS) & Cloudflare Worker
│       ├── Dockerfile
│       └── wrangler.jsonc
└── .github/workflows/   # CI (typecheck) + deploy (GHCR image, VPS ssh)
```

## Proxy endpoints

| Endpoint | Query | Description |
|---|---|---|
| `GET /healthz` | — | liveness check |
| `GET /search` | `q`, `filter=song\|video\|album\|artist\|playlist` | search (10 min cache) |
| `GET /home` | — | home feed, personalized when cookie sent (5 min cache) |
| `GET /library` | — | account library — **requires** `x-yt-cookie` |
| `GET /browse` | `id` | album / artist / playlist details |
| `GET /next` | `videoId` | radio queue (up to 50 items) |
| `GET /player` | `videoId` | deciphered stream URL + metadata |
| `GET /stream` | `videoId` | relay fallback — audio bytes streamed via server |

Account cookie is passed per-request via the `x-yt-cookie` header and is never stored server-side.

## Getting started

### Prerequisites

- Node.js 22+
- npm (workspace root)

### Run the proxy locally

```bash
npm install
npm run proxy:dev          # http://localhost:3000

curl localhost:3000/healthz
curl "localhost:3000/search?q=radwimps&filter=song"
```

### Deploy the proxy

**VPS (Docker — primary):**

```bash
cd packages/proxy
docker compose up -d --build
```

Or use the CI-built image from GHCR: `ghcr.io/muhwldns/sonora-online-music-player/proxy:latest`

**Cloudflare Workers (instant alternative):**

```bash
cd packages/proxy
npx wrangler kv namespace create CACHE   # put the id into wrangler.jsonc
npm run deploy:cf
```

Requires the Workers **Paid** plan ($5/mo) — InnerTube response parsing exceeds the Free plan's 10 ms CPU limit.

### Mobile app

```bash
cd apps/mobile
npm install
npx expo start
```

## CI/CD

- **CI** (every push/PR): typecheck proxy + app, Workers bundle dry-run.
- **Deploy** (push to `main` touching `packages/proxy/**`):
  1. Build multi-arch Docker image → push to GHCR
  2. SSH into the VPS → `docker compose pull && up -d` (gated on `VPS_HOST` variable + `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY` secrets)

## Technical notes & known risks

1. **IP binding of stream URLs** — `X-Forwarded-For` is ignored by YouTube when binding the `ip=` parameter for WEB_REMIX clients. If the device gets a 403 fetching a URL from `/player` directly, the client falls back to `/stream` (server relay — IPs always match).
2. **googlevideo requires `Range` + browser `User-Agent`** on fetches — handled in `/stream`.
3. **PO tokens** are not implemented yet; if YouTube starts requiring them, [bgutils-js](https://github.com/LuanRT/bgutils-js) slots into the `/player` layer.
4. **Login** — Google blocks embedded-webview logins, so the app uses cookies exported from a real browser session (stored in the device keychain).

## Legal

This project is for personal use. It is not affiliated with YouTube or Google. Streaming YouTube content through unofficial clients may violate the YouTube Terms of Service — you are responsible for your own usage.

## License

[MIT](LICENSE)
