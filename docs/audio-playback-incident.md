# Android Audio Playback Incident

**Status:** playback startup fixed and deployed; continuity and player-lifecycle follow-ups remain open  
**Validated on:** MuMu Player, Android package `com.sonora.music`  
**Live proxy:** <https://sonora.rbxskuy.web.id>  
**Primary fix:** `37f652a fix(proxy): bound upstream audio ranges`

## Executive summary

Tapping a song used to create the mini-player without producing audio. The app's native Media3 session entered `Source error`, no `AudioTrack` started, and the player remained at position zero.

The failing boundary was the proxy's `/stream` endpoint. It requested Google Video with an open-ended `Range: bytes=0-`. Google Video intermittently rejected that request with HTTP 403. The proxy converted the rejection to HTTP 502, which Media3 surfaced as a source error.

The deployed fix converts missing or open-ended ranges into a bounded 1 MiB upstream request. The same track then started correctly in MuMu: Media3 entered `PLAYING`, the Android audio track started, and playback position advanced. Production now returns a valid `206 audio/mp4` response for the same request.

## User-visible symptoms

- Tapping a song showed the mini-player but produced no sound.
- The debug overlay remained similar to:

  ```text
  state=idle load=false play=false buf=false t=0.0
  uri=https://sonora.rbxskuy.web.id/stream?videoId=-TVknpWcCIo
  ```

- Android's media session reported:

  ```text
  state=7, position=0, error=Source error
  ```

- No active `AudioPlaybackConfiguration` existed for Sonora.

## Investigation method

Each experiment changed one variable and was checked at every component boundary:

1. Search/parser output and canonical YouTube video ID.
2. Mobile URL construction.
3. Proxy `/player` and `/stream` responses.
4. Google Video's response to specific Range headers.
5. Expo Audio status events.
6. Android MediaSession and AudioTrack state.

## Findings

### 1. Invalid video IDs could reach playback

An earlier parser fallback could place a non-video token in `videoId`. That produced malformed `/stream` requests.

Solved by:

- `a6d9f01`: validate canonical 11-character YouTube video IDs in parser fallback paths.
- `3c97792`: URL-encode `videoId` in the mobile API client.
- `37f652a`: add the same canonical guard to the search top-result card parser.

### 2. The suspected client-side ID corruption was not real

The UI appeared to show `-1VknpWcClo`, while the API returned `-TVknpWcCIo`. Runtime inspection and the debug overlay later showed the exact canonical string:

```text
-TVknpWcCIo
```

The discrepancy was display/font ambiguity, not string mutation in the data path.

### 3. Direct Google Video playback was not a reliable fix

`/player` returned a deciphered Google Video URL. A bounded curl probe could fetch bytes from MuMu, but Expo Audio still entered `Source error` when given the direct URL. Requests without the required bounded range were rejected.

That experiment was removed. The mobile app continues to use `/stream`, which keeps IP binding and request-shape handling on the proxy.

### 4. Open-ended upstream ranges caused startup failure

Before the fix, `/stream` sent this upstream when Media3 omitted a range:

```http
Range: bytes=0-
```

For the tested track, Google Video returned 403. The proxy returned:

```http
HTTP/1.1 502 Bad Gateway
{"error":"upstream 403"}
```

A bounded request for the same URL worked:

```http
Range: bytes=0-1048575
```

and returned:

```http
HTTP/1.1 206 Partial Content
Content-Type: audio/mp4
Content-Range: bytes 0-1048575/6017604
Content-Length: 1048576
```

## Implemented fix

`packages/proxy/src/stream-range.ts` now applies these rules:

- Missing client range → `bytes=0-1048575`
- Open-ended `bytes=N-` → one bounded 1 MiB range starting at `N`
- Already bounded `bytes=N-M` → preserve it

`packages/proxy/src/index.ts` uses the helper for `/stream` upstream requests.

Focused Node tests cover all three cases in `packages/proxy/src/stream-range.test.ts`.

## Verification evidence

### Automated

- Proxy range tests: 3 passing.
- Proxy TypeScript check: passing.
- Proxy production build: passing.
- Mobile TypeScript check: passing.

### Local integration in MuMu

The app was pointed to the locally built proxy through ADB reverse. The same `Membasuh` track produced:

```text
PlaybackState state=3
error=null
position=17470
buffered position=64561
speed=1.0
```

Android also reported a started `AudioTrack` owned by `com.sonora.music`.

### Production

After pushing `37f652a`, the live endpoint returned:

```http
HTTP/1.1 206 Partial Content
Content-Type: audio/mp4; codecs="mp4a.40.2"
Content-Length: 1048576
Content-Range: bytes 0-1048575/6017604
```

The user independently confirmed that audio became audible.

## Remaining issues

### A. Playback stops near 64.6 seconds

**Status:** confirmed, open.

Playback stops exactly at the end of the first 1 MiB chunk:

```text
position=64574
buffered position=64574
state=7
error=Source error
```

The first request has no client Range. The proxy currently returns one bounded upstream chunk as HTTP 200 while advertising the full file length. Media3 therefore treats the 1 MiB EOF as a truncated source instead of requesting the next chunk.

This needs a complete-body relay strategy for no-Range requests, not another isolated range-header tweak.

### B. Previous song can continue after selecting another song

**Status:** reported, investigation pending.

The mobile service calls `AudioPlayer.remove()` before creating the next player. Expo Audio removes the player from its registry immediately, but native release is tied to shared-object lifetime. The next experiment must determine whether explicit `pause()` and `release()` are required before dropping the previous player.

### C. Home Library content cannot be opened

**Status:** reported, investigation pending.

This is tracked separately because it belongs to navigation/data handling rather than the audio transport.

## Operational notes

- Do not replace `/stream` with direct `/player` URLs without a new end-to-end proof on Android.
- Keep Google Video experiments single-variable: range form, offset, size, and headers materially affect the response.
- Verify playback with both app state and native state. A visible mini-player is not proof that an Android `AudioTrack` started.
- Use the live health check at <https://sonora.rbxskuy.web.id/healthz> before production playback tests.
