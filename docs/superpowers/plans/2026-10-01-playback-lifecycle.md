# Playback Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native 5/15/30-minute and end-of-track sleep timers plus exact paused restoration of queue, track, position, shuffle, and repeat after process/device restart.

**Architecture:** `SonoraPlaybackService` owns authoritative state and a versioned Android snapshot. JavaScript retrieves metadata, refreshes proxy stream URLs, and calls a restore-only native method that prepares without autoplay.

**Tech Stack:** Kotlin, Android Media3, Expo native module, TypeScript, React Native.

**Spec:** `docs/superpowers/specs/2026-10-01-personal-music-features-design.md`

## Global Constraints

- Native playback service owns queue transitions and sleep timer enforcement.
- Persist no cookie or stream URL.
- Cold restoration always ends paused.
- Preserve exact shuffled order and current track.
- Timer options are exactly 5, 15, 30 minutes, and end of track.
- Repeat modes are exactly `off`, `all`, and `one`.

## Review Focus

- Process death between snapshot writes must restore a coherent previous checkpoint.
- An expired timer after reboot must remain paused and clear itself.
- Manual Next under end-of-track mode must prevent the new track from audibly starting.
- Corrupt queue/index/shuffle data must clear or normalize without crashing.
- One failed stream refresh must not shift queue indices.

---

### Task 1: Pure native session and timer models

**Files:**
- Create: `apps/mobile/modules/sonora-media-controls/android/src/main/java/com/sonora/music/mediacontrols/PlaybackSessionSnapshot.kt`
- Create: `apps/mobile/modules/sonora-media-controls/android/src/main/java/com/sonora/music/mediacontrols/SleepTimerState.kt`
- Create: `apps/mobile/modules/sonora-media-controls/android/src/test/java/com/sonora/music/mediacontrols/PlaybackSessionSnapshotTest.kt`
- Modify: `apps/mobile/modules/sonora-media-controls/android/build.gradle` to add the JUnit test dependency and Android unit-test options used by `testDebugUnitTest`.

**Interfaces:**
- Produces: versioned serializable `PlaybackSessionSnapshot`, `PersistedTrack`, `RepeatMode`, and `SleepTimerState`.
- Produces: validation/normalization functions for index, position, and shuffle permutation.

- [ ] Write failing JVM tests for corrupt versions, invalid indices, duplicate/missing shuffle indices, timer expiry, and armed-video matching.
- [ ] Run the native unit-test Gradle task; expect compile failure for missing models.
- [ ] Implement immutable models and validators with snapshot version `1`.
- [ ] Run the unit tests; expect PASS.
- [ ] Commit with `feat(android): define playback session snapshot`.

### Task 2: Native persistence and Media3 listener

**Files:**
- Create: `apps/mobile/modules/sonora-media-controls/android/src/main/java/com/sonora/music/mediacontrols/PlaybackSessionStore.kt`
- Modify: `apps/mobile/modules/sonora-media-controls/android/src/main/java/com/sonora/music/mediacontrols/SonoraPlaybackService.kt`
- Test: native JVM tests.

**Interfaces:**
- Produces: `load(): PlaybackSessionSnapshot?`, `save(snapshot)`, `clear()`.
- Service checkpoints structural state immediately and position at most once per five seconds.

- [ ] Write failing store tests for round-trip, corrupt JSON, unknown version, clear, and atomic last-good behavior.
- [ ] Implement `SharedPreferences` persistence and attach one `Player.Listener` in the service.
- [ ] Add tests for repeat mapping and queue-change checkpoint creation.
- [ ] Run native tests; expect PASS.
- [ ] Commit with `feat(android): persist authoritative playback state`.

### Task 3: Native sleep timer engine

**Files:**
- Create: `apps/mobile/modules/sonora-media-controls/android/src/main/java/com/sonora/music/mediacontrols/SleepTimerController.kt`
- Modify: `SonoraPlaybackService.kt`
- Test: native JVM tests.

**Interfaces:**
- Produces: `setDuration(minutes: 5|15|30)`, `setEndOfTrack(videoId)`, `cancel()`, `snapshot(now)`.
- Produces timer state changes through the media session/custom command layer.

- [ ] Write failing tests using an injected clock/scheduler for replacement, expiry, restart remainder, manual pause preservation, queue clear cancellation, natural completion, and explicit track change.
- [ ] Implement timer scheduling in the service and pause-before-next behavior for end-of-track mode.
- [ ] Run native tests; expect PASS.
- [ ] Commit with `feat(android): add native playback sleep timer`.

### Task 4: Native bridge for restore, repeat, timer, and snapshot

**Files:**
- Modify: `apps/mobile/modules/sonora-media-controls/android/src/main/java/com/sonora/music/mediacontrols/SonoraMediaControlsModule.kt`
- Modify: `apps/mobile/modules/sonora-media-controls/src/SonoraMediaControlsModule.ts`

**Interfaces:**
- Produces: `getPersistedSession(): Promise<PersistedSession | null>`.
- Produces: `restoreQueue(tracks, index, positionMs, shuffleOrder, shuffleEnabled, repeatMode): Promise<void>`.
- Produces: `setRepeatMode(mode)`, `setSleepTimer(choice)`, `cancelSleepTimer()`.
- Extends `PlaybackStatus` with `repeatMode`, `sleepTimer`, `activeVideoId`, and transition reason.

- [ ] Add TypeScript contract fixtures/type assertions and native tests that `restoreQueue` calls prepare but never play.
- [ ] Implement records, methods, Media3 shuffle order restoration, repeat mapping, and enriched status events.
- [ ] Run native tests and mobile typecheck; expect PASS.
- [ ] Commit with `feat(player): expose session restore and timer bridge`.

### Task 5: JavaScript restoration policy and service integration

**Files:**
- Create: `apps/mobile/src/player/sessionRestorePolicy.ts`
- Create: `apps/mobile/src/player/sessionRestorePolicy.test.ts`
- Modify: `apps/mobile/src/player/service.ts`
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Produces: `restorePersistedSession(): Promise<'empty'|'restored'|'recoverable-error'>`.
- Extends `PlayerState` with `repeatMode`, `sleepTimer`, and `restoring`.

- [ ] Write failing tests for snapshot validation, active-first hydration, bounded concurrency, preserved slots, clamped position, and paused result.
- [ ] Implement startup restoration after native setup; refresh URLs through `streamUrl`, preserving queue slots and index.
- [ ] Ensure radio seeding/continuation does not run during restoration.
- [ ] Run policy tests and mobile typecheck; expect PASS.
- [ ] Commit with `feat(player): restore paused playback sessions`.

### Task 6: Player controls and recovery UI

**Files:**
- Create: `apps/mobile/src/components/player/SleepTimerSheet.tsx`
- Modify: `apps/mobile/src/components/player/FullPlayerModal.tsx`
- Modify: `apps/mobile/src/components/player/QueueEditor.tsx`
- Modify: `apps/mobile/src/components/player/MiniPlayer.tsx`

**Interfaces:**
- Consumes: Task 4/5 player state and operations.
- Produces: repeat cycle `off -> all -> one -> off`, timer choices, countdown/status, cancel, and retry restoration action.

- [ ] Extract and test display policy for repeat labels, timer remaining text, and accessibility announcements.
- [ ] Implement controls with selected/busy state and exact Indonesian labels.
- [ ] Run tests and mobile typecheck.
- [ ] Verify on Android: all timer choices, replacement/cancel, background expiry, notification Next under end-of-track, repeat modes, process kill, and cold restore without autoplay.
- [ ] Reboot the test device and verify queue/index/position/shuffle order/repeat plus absolute timer remainder.
- [ ] Commit with `feat(mobile): add playback lifecycle controls`.
