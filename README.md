# Sonora

Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_PROXY_BASE` to the URL of your own proxy instance before building the mobile app. The app also accepts a proxy URL in Settings.

**Sonora** is a self-hosted YouTube Music client for people who want full control over their listening experience. It pairs a React Native app with a completely custom UI against a lightweight proxy server that speaks YouTube's internal InnerTube API.

The proxy runs as a Docker container on a self-hosted Node.js server. Authentication is cookie-based — your account stays yours, credentials never leave your device except per-request, and the server stays fully stateless. Audio is relayed through the proxy with content-bound PO tokens so IP-bound Google Video streams remain playable.

> Early stage: the proxy is working and verified; the mobile app is under active development.

## Features

- Search (songs, albums, artists, playlists) via YouTube Music, with bounded on-device recent searches, clear-one/clear-all controls, and a deterministic daily discovery panel
- Home feed with your account's personalized recommendations
- Cookie-authenticated Library access, including private-playlist creation and saving or removing playlists from the account library
- Audio playback with queue/radio (up next) support
- Editable queue — reorder by drag, swipe to remove, and add next or to the end without interrupting the current track
- Playback-synchronized lyrics in the full player via exact LRCLIB title + artist + duration matching, with a timed-line position indicator, measured active-line centering, tap-to-seek, reduced-motion support, session caching, and YouTube Music plain-text fallback
- One-command deployment on a self-hosted Node.js server via Docker

## Repository layout

```
├── apps/
│   └── mobile/          # React Native (Expo) app — custom UI client
├── packages/
│   └── proxy/           # InnerTube proxy (Hono + youtubei.js)
│       ├── src/         #   runtime-agnostic app code
│       ├── server/      #   Node entrypoint; experimental Worker adapter retained
│       ├── Dockerfile
│       └── wrangler.jsonc
└── .github/workflows/   # CI (typecheck) + deploy (GHCR image, VPS ssh)
```

## Proxy endpoints

| Endpoint | Input | Description |
|---|---|---|
| `GET /healthz` | — | liveness check |
| `GET /search` | `q`, `filter=song\|video\|album\|artist\|playlist` | search (10 min cache) |
| `GET /home` | — | home feed, personalized when cookie sent (5 min cache) |
| `GET /library` | — | account library — **requires** `x-yt-cookie` |
| `POST /playlists` | JSON `{ "title": "…" }` | create a private account playlist — **requires** `x-yt-cookie` |
| `PUT /library/playlists/:playlistId` | path parameter | save a playlist to the account library — **requires** `x-yt-cookie` |
| `DELETE /library/playlists/:playlistId` | path parameter | remove a playlist from the account library — **requires** `x-yt-cookie` |
| `GET /browse` | `id` | album / artist / playlist details, including authoritative saved state when YouTube Music exposes it |
| `GET /next` | `videoId` | radio queue (up to 50 items) plus its YTM continuation token |
| `GET /next/continue` | `token` | next queue page plus its YTM continuation token |
| `GET /player` | `videoId` | deciphered stream URL + metadata |
| `GET /lyrics` | `videoId` | exact LRCLIB synchronized lyrics when available, otherwise the YouTube Music plain lyrics shelf; HTTP 200 with `lyrics: null` confirms no result, while HTTP 503 means both sources were temporarily unable to provide lyrics and the client may retry |

Account cookie is passed per-request via the `x-yt-cookie` header and is never stored server-side.

Playlist mutations use the same per-request cookie boundary as Library reads. New playlists are always created as private; the proxy forwards each mutation to YouTube Music and retains neither account state nor playlist titles.

Recent Search entries and the daily discovery rotation are bounded local app state. Individual or complete history removal affects only the device; the proxy receives a query only when the user submits that search.
For lyrics, the proxy derives public title, artist, and duration metadata from the exact requested item in YouTube Music's `/next` response, then sends only those three values to LRCLIB. The YouTube account cookie and inbound request headers are never forwarded to LRCLIB. Exact synchronized matches take precedence; YouTube Music plain lyrics remain the fallback. Availability can still vary by catalog and region. Sonora performs no fuzzy lyric matching and contacts no additional lyric providers.
Radio recommendations remain in YouTube Music's algorithmic order. The client
chains continuation pages, deduplicates by video ID, and caps its live queue at
100 tracks. It also keeps a bounded local per-seed history of appended video IDs
to provide best-effort replay rotation across starts; this is not guaranteed
diversity and does not locally shuffle recommendations. If a seed's available
history is exhausted, its history may be reset once so playback can reuse the
current upstream response. If a continuation is missing or expires near the tail, it performs
one guarded reseed from the active track; it does not locally shuffle or mix
multiple seeds, and no recommendation diversity is guaranteed.

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
3. **PO tokens** are generated by the Node proxy provider; configure and operate your own proxy instance.
4. **Login** — Google blocks embedded-webview logins, so the app uses cookies exported from a real browser session (stored in the device keychain).
5. **In-app update check** — the app reads the public GitHub Releases API (`releases/latest`) directly, never through the proxy, so no account cookie is ever sent. The installed version comes from the embedded `app.json` version. Checks run at cold start and on foreground, are throttled to once per 6 hours, and fail silently when offline. The prompt appears at most once per session; "Nanti" snoozes 3 days and "Lewati versi ini" hides only that version. The prompt shows only the version numbers — release notes are never rendered in-app; "Update sekarang" opens the official release page in the browser, where the notes and download live. The app never downloads or installs an APK and requests no new permissions. Prompts fire automatically for GitHub releases that are neither drafts nor prereleases.

## Legal

This project is for personal use. It is not affiliated with YouTube or Google. Streaming YouTube content through unofficial clients may violate the YouTube Terms of Service — you are responsible for your own usage.

## License

[MIT](LICENSE)
