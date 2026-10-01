# Personal Music Features Design

## Goal

Deliver seven complete Sonora features: song like/unlike, owned-playlist editing, a native sleep timer, paused playback restoration, local per-video lyric offsets, local listening statistics for 7/30/365 days with reset/export, and richer search discovery.

## Product constraints

- The proxy remains stateless. Every authenticated mutation receives the YouTube cookie through `x-yt-cookie`; the server never stores it.
- Deployment URLs and credentials stay outside source control.
- Account mutations are available only when a cookie is configured and return a clear login-required response on `401`.
- Local personal data stays on the device.
- A restored playback session never autoplays.
- Android native Media3 owns playback, queue transitions, sleep-timer enforcement, and authoritative playback state.
- JavaScript obtains fresh stream relay URLs from the configured proxy after a cold start.

## Program decomposition and delivery order

1. **Account actions:** song like/unlike and owned-playlist editing.
2. **Playback lifecycle:** sleep timer plus queue/session restoration.
3. **Local listening data:** lyric offsets and listening statistics.
4. **Search experience:** remote suggestions, pinned history, persisted last filter, and contextual search shortcuts.

Account actions are independent. Playback lifecycle precedes listening statistics because native playback events provide the reliable listening segments. Search can be implemented independently after its route and navigation contracts are fixed.

## Account actions

### Song like state

The proxy exposes an authenticated idempotent song-state endpoint. `PUT /library/songs/:videoId` sets `LIKE`; `DELETE` sets `INDIFFERENT`. Both validate an 11-character video ID and call the raw InnerTube like endpoint with the per-request cookie. Responses use `{ videoId, liked }`.

Like state is included where upstream renderers expose it and otherwise starts as unknown. Mobile keeps a session-level state map keyed by `videoId`, updates it after successful mutations, and presents the action in the full player and reusable song menus. Failed optimistic changes roll back. `401` directs the user to Settings.

### Owned playlist editing

Browse parsing distinguishes an owned editable playlist from a saved external playlist. Editable responses include canonical playlist ID, title, description where available, privacy, and per-row `setVideoId`; `setVideoId` is required for exact removal and reorder operations.

Authenticated endpoints support:

- update title/description/privacy;
- add one or more video IDs;
- remove entries by `setVideoId`;
- reorder an entry using the upstream move token contract;
- delete the owned playlist after explicit confirmation.

The mobile editor lives on the existing Browse route. It supports metadata editing, add-from-search/current-track, remove, reorder, and deletion. It serializes mutations per playlist and reloads authoritative browse data after uncertain upstream responses.

## Playback lifecycle

### Session snapshot

Native stores a versioned snapshot containing queue metadata, active index, position, exact shuffle order, shuffle enabled, repeat mode (`off | all | one`), sleep timer, and update timestamp. It contains no cookie and no persistent stream URL.

Native checkpoints immediate structural changes and throttles position writes to five seconds. Invalid or unknown-version snapshots are cleared safely.

At first app open after process death or device restart, JavaScript reads the snapshot, refreshes stream URLs with bounded concurrency, restores the queue/index/position/shuffle/repeat through a dedicated native operation, prepares Media3, and remains paused. The active track is prioritized. A failed active URL leaves visible recoverable state and a retry action.

### Sleep timer

Supported choices are 5, 15, 30 minutes, and end of track. Duration timers persist an absolute expiry timestamp. A surviving timer resumes with its remaining wall-clock time after process/device restart; an expired timer is cleared and playback remains paused.

End-of-track arms against the current video. Natural completion or an explicit track change pauses before the next track plays and clears the timer. A new timer replaces the old timer. Clearing the queue cancels it. Manual pause preserves a duration timer.

## Local lyric offset

AsyncStorage stores one signed millisecond offset per `videoId`, clamped to `-5000..5000`; storing zero removes the entry. Positive values advance lyrics and the shared position model uses `playbackTimeMs + offsetMs`. The full lyrics view provides `-0.5s`, reset, and `+0.5s` controls and announces the resulting value. Preview, active row, position indicator, centering, and row-tap seek share this model; row-tap uses the inverse offset. Unsynchronized lyrics hide the controls. Offsets remain local and storage is never touched on playback ticks.

## Listening statistics

Native status events expose enough information to construct played segments while playback is actually advancing. JavaScript records compact local events keyed by day and track: listened milliseconds, completed plays, title, artist, and thumbnail. A play is counted after at least 30 seconds of accumulated listening or 50% of known duration, whichever occurs first. Seek jumps and buffering time are excluded; replay can create a new play after completion or restart.

Storage retains 365 local calendar days. Aggregation provides 7/30/365-day total listening time, play count, top tracks, and top artists. Settings links to a Statistics screen. Reset requires confirmation. Export uses the platform share sheet with a versioned JSON document and an accompanying CSV summary created in the cache directory; cancelled sharing preserves data.

## Search experience

The proxy adds `/search/suggestions?q=` and parses upstream query suggestions into a deduplicated list. Mobile debounces non-empty input by 200 ms, cancels stale requests, and falls back to local pinned/recent queries while offline.

Search history entries gain `pinned`. Pinned entries remain ahead of recency entries, survive normal history clearing, and can be individually unpinned/deleted. “Clear all” clears unpinned entries; a separate confirmed action clears everything.

The last selected search filter is persisted locally and restored on later visits. Contextual shortcuts navigate to Search with a prefilled query and optional filter from artist, album/playlist, and current-track surfaces. Prefill focuses the input but requires user submission, preserving control over history creation.

## Error handling

- Proxy validates identifiers, body shapes, lengths, privacy enum, and mutation cardinality before calling InnerTube.
- Auth failures return `401`; rejected upstream operations map to stable `400`, `404`, or `409` responses where identifiable; unknown upstream failures remain `502`.
- Mobile prevents duplicate submissions, retains user edits after recoverable failure, and reloads authoritative state after ambiguous mutations.
- Local stores validate and sanitize every persisted payload and degrade to an empty/default state when corrupt.
- Export and sharing errors appear to the user without deleting statistics.

## Testing and verification

- Proxy: route tests with injected fake Innertube, parser fixtures for like/editable playlist/suggestions, auth and validation cases.
- Mobile pure logic: policies for history pins, offsets, listening segments/aggregation/export, snapshot validation, and search prefill.
- Native: JVM tests for snapshot validation, shuffle order, repeat mapping, timer expiry, end-of-track transitions, and persistence migration.
- Type checks: proxy and mobile commands documented in `Agents.md`, plus Workers bundle dry-run.
- Device verification: Android cold start, process kill, device restart, notification controls, background timer, account mutation flows, local persistence, sharing, offline suggestion fallback, and accessibility announcements.

## Out of scope

- Cloudflare Worker as a full playback backend.
- Cross-device synchronization of offsets, statistics, search preferences, or playback sessions.
- Automatic APK installation or background account synchronization.
- Collaborative playlist editing.
