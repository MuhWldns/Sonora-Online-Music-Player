# Local Listening Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent per-video lyric synchronization offsets and accurate local 7/30/365-day listening statistics with reset and export.

**Architecture:** Small validated AsyncStorage stores hold offsets and daily aggregate events. A pure playback-segment reducer consumes authoritative native status transitions; pure selectors build time-window summaries and export documents.

**Tech Stack:** TypeScript, React Native AsyncStorage, Expo FileSystem/Sharing or React Native Share APIs available for Expo 57.

**Spec:** `docs/superpowers/specs/2026-10-01-personal-music-features-design.md`

## Global Constraints

- Data remains local and contains no cookie.
- Lyric offsets are keyed by `videoId`, clamped to `-5000..5000` ms, adjusted in 500 ms steps, and a zero value removes the stored entry.
- Statistics retain 365 local-calendar days.
- Count a play after 30 seconds accumulated or 50% of known duration, whichever occurs first.
- Exclude buffering, paused wall time, and seek jumps.
- Reset requires confirmation; cancelled/failed export preserves data.

## Review Focus

- Daylight-saving/local-midnight boundaries must assign listening to the correct local day.
- Position discontinuities from seek or restore must not inflate time.
- A process death may lose only the uncheckpointed segment, never corrupt prior totals.
- Unknown duration still uses the 30-second play threshold.
- Corrupt/export-hostile text must produce valid JSON and CSV.

---

### Task 1: Lyric offset policy and storage

**Files:**
- Create: `apps/mobile/src/storage/lyricOffsetsPolicy.ts`
- Create: `apps/mobile/src/storage/lyricOffsetsPolicy.test.ts`
- Create: `apps/mobile/src/storage/lyricOffsets.ts`

**Interfaces:**
- Produces: `clampLyricOffset(ms): number`, `applyLyricOffset(playbackMs, offsetMs): number`.
- Produces: `getLyricOffset(videoId): Promise<number>`, `setLyricOffset(videoId, ms): Promise<number>`, `resetLyricOffset(videoId)`.

- [ ] Write failing tests for ±5-second clamp, 500 ms adjustment, zero-entry deletion, invalid IDs/data, negative adjusted playback, and independent video keys.
- [ ] Run `node --import tsx --test apps/mobile/src/storage/lyricOffsetsPolicy.test.ts`; expect missing-module failure.
- [ ] Implement pure policy and a serialized, validated AsyncStorage store.
- [ ] Run tests and mobile typecheck; expect PASS.
- [ ] Commit with `feat(mobile): persist lyric synchronization offsets`.

### Task 2: Apply offset to every lyric surface

**Files:**
- Modify: `apps/mobile/src/components/player/lyricsPosition.ts`
- Modify: `apps/mobile/src/components/player/AnimatedLyricsView.tsx`
- Modify: `apps/mobile/src/components/player/FullPlayerModal.tsx`
- Create: `apps/mobile/src/components/player/LyricOffsetControls.tsx`
- Modify/add: lyric position tests.

**Interfaces:**
- Consumes: Task 1 offset APIs.
- Produces: offset-aware preview, active row, position indicator, centering, and inverse row-tap seek plus controls for `-0.5s`, reset, `+0.5s`.

- [ ] Write failing lyric-position tests proving all timed displays use `playbackMs + offsetMs`, row taps seek to `lineStartMs - offsetMs`, and unsynchronized lyrics ignore offsets.
- [ ] Implement a shared offset hook and controls; hide controls for unsynchronized lyrics and announce saved value for accessibility.
- [ ] Run focused tests and mobile typecheck.
- [ ] Verify offsets update full lyrics and compact preview immediately and survive app restart.
- [ ] Commit with `feat(player): add per-track lyric offset controls`.

### Task 3: Listening segment reducer

**Files:**
- Create: `apps/mobile/src/stats/listeningPolicy.ts`
- Create: `apps/mobile/src/stats/listeningPolicy.test.ts`

**Interfaces:**
- Produces: `reducePlaybackSample(state, sample): { state, segments, completedPlays }`.
- Input sample includes wall time, media position, playing/buffering, video ID, duration, and transition reason.

- [ ] Write failing tests for normal progress, pause, buffering, seek forward/backward, repeat, track change, restoration, unknown duration, threshold crossing once, and local-midnight split.
- [ ] Implement the reducer with bounded media delta versus wall delta and explicit discontinuity handling.
- [ ] Run tests; expect PASS.
- [ ] Commit with `feat(stats): define listening segment accounting`.

### Task 4: Statistics store and retention

**Files:**
- Create: `apps/mobile/src/stats/listeningStore.ts`
- Create: `apps/mobile/src/stats/listeningStore.test.ts`
- Modify: `apps/mobile/src/player/service.ts`

**Interfaces:**
- Produces: `recordListeningSegments(segments)`, `loadListeningDays()`, `resetListeningStats()`, `subscribeListeningStats(listener)`.
- Consumes enriched native status from playback lifecycle plan.

- [ ] Write failing tests for serialized writes, same-track/day aggregation, 365-day pruning, corrupt payload, process restart, and reset.
- [ ] Implement store and connect one reducer instance to player status events; checkpoint active segments periodically and on pause/track transition.
- [ ] Run store/policy tests and mobile typecheck.
- [ ] Commit with `feat(stats): record local listening activity`.

### Task 5: Window aggregation and export

**Files:**
- Create: `apps/mobile/src/stats/statisticsSelectors.ts`
- Create: `apps/mobile/src/stats/statisticsSelectors.test.ts`
- Create: `apps/mobile/src/stats/statisticsExport.ts`
- Create: `apps/mobile/src/stats/statisticsExport.test.ts`

**Interfaces:**
- Produces: `summarizeListening(days, window: 7|30|365, now): StatisticsSummary`.
- Produces: `buildStatisticsJson(days, exportedAt)` and `buildStatisticsCsv(days)`.

- [ ] Write failing tests for inclusive local date windows, totals, stable top-track/artist tie-breaking, empty data, Unicode, quotes/newlines, JSON schema version, and CSV escaping.
- [ ] Implement selectors and pure export builders.
- [ ] Run tests; expect PASS.
- [ ] Commit with `feat(stats): aggregate and export listening insights`.

### Task 6: Statistics screen, reset, and share

**Files:**
- Create: `apps/mobile/src/screens/StatisticsScreen.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Consumes: Task 4/5 store, selectors, exports.
- Produces: window tabs 7/30/365, totals, top tracks/artists, reset confirmation, and JSON/CSV share action.

- [ ] Add any required Expo-compatible file/share packages using the installed Expo SDK resolver.
- [ ] Add pure view-model tests for empty/non-empty summaries and reset/export busy states.
- [ ] Implement screen and navigation; write files only to cache and delete temporary files after sharing when safe.
- [ ] Run all stats tests and mobile typecheck.
- [ ] Verify on Android: foreground/background listening, seek exclusion, all windows, empty state, reset cancel/confirm, JSON and CSV share cancellation/success.
- [ ] Commit with `feat(mobile): add local listening statistics`.
