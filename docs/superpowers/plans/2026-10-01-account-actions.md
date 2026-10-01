# Account Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated song like/unlike and complete editing for playlists owned by the user.

**Architecture:** Portable proxy routes perform validated, stateless InnerTube mutations using the request cookie. Parsers expose mutation tokens and ownership; mobile API adapters and focused UI components consume that contract and reconcile with authoritative browse state.

**Tech Stack:** TypeScript, Hono, youtubei.js raw execute, React Native, AsyncStorage session state, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-personal-music-features-design.md`

## Global Constraints

- `packages/proxy/src/` uses Web Standard APIs only; Innertube is injected.
- Cookie is accepted only through `x-yt-cookie` per request and is never persisted by the proxy.
- Validate every video ID, playlist ID, `setVideoId`, title, description, and privacy value before upstream calls.
- Preserve current create/save playlist behavior.
- Mutations require cookie and return `401` when absent.

## Review Focus

- Duplicate playlist rows with the same `videoId` must remove/reorder the exact `setVideoId` selected.
- A stale upstream mutation token must cause reload/retry guidance, never silent local divergence.
- Like requests repeated with the same desired state must be safe.
- External saved playlists must never expose destructive owner controls.
- Partial add failures must report which video IDs failed and reload authoritative state.

---

### Task 1: Account mutation validators and parser contracts

**Files:**
- Modify: `packages/proxy/src/playlists.ts`
- Modify: `packages/proxy/src/parsers.ts`
- Test: `packages/proxy/test/parsers.test.ts`
- Test: `packages/proxy/test/playlist-routes.test.ts`

**Interfaces:**
- Produces: `canonicalVideoId(value): string | null`, `canonicalSetVideoId(value): string | null`, `normalizePlaylistDescription(value): string | null`, `normalizePlaylistPrivacy(value): 'PRIVATE' | 'UNLISTED' | 'PUBLIC' | null`.
- Produces: `ParsedItem.setVideoId?: string`, `ParsedPlaylistEditState { id, editable, title, description, privacy }` and editable playlist fields in browse parsing.

- [ ] Write failing parser/validator tests for valid boundaries, duplicate video rows with distinct `setVideoId`, owned headers, external playlists, and malformed values.
- [ ] Run `npm test -w @sonora-music/proxy -- parsers.test.ts playlist-routes.test.ts`; expect new assertions to fail.
- [ ] Implement the validators and parser fields without changing existing `ParsedItem` semantics.
- [ ] Run the focused tests; expect PASS.
- [ ] Commit with `feat(proxy): parse editable playlist state`.

### Task 2: Song like/unlike proxy API

**Files:**
- Modify: `packages/proxy/src/index.ts`
- Create: `packages/proxy/test/song-library-routes.test.ts`

**Interfaces:**
- Produces: `PUT /library/songs/:videoId -> { videoId, liked: true }`.
- Produces: `DELETE /library/songs/:videoId -> { videoId, liked: false }`.

- [ ] Write failing route tests for missing cookie, invalid ID, `LIKE`, `INDIFFERENT`, repeated desired state, and upstream rejection.
- [ ] Run `npm test -w @sonora-music/proxy -- song-library-routes.test.ts`; expect route-not-found failures.
- [ ] Implement both routes using injected Innertube and the raw like endpoint; clear account-scoped feed/history cache entries after success.
- [ ] Run the focused test and `npm run typecheck -w @sonora-music/proxy`; expect PASS.
- [ ] Commit with `feat(proxy): add song library mutations`.

### Task 3: Owned playlist mutation proxy API

**Files:**
- Modify: `packages/proxy/src/index.ts`
- Create: `packages/proxy/test/playlist-editor-routes.test.ts`

**Interfaces:**
- Produces: `PATCH /playlists/:playlistId` body `{ title?, description?, privacy? }`.
- Produces: `POST /playlists/:playlistId/items` body `{ videoIds: string[] }` returning per-ID results.
- Produces: `DELETE /playlists/:playlistId/items/:setVideoId`.
- Produces: `PATCH /playlists/:playlistId/items/:setVideoId` body `{ successorSetVideoId?: string }`.
- Produces: `DELETE /playlists/:playlistId`.

- [ ] Write failing tests for auth, shape/cardinality limits, exact duplicate-row tokens, reorder endpoints, delete, cache invalidation, and stable error mapping.
- [ ] Run the focused test; expect failures because routes do not exist.
- [ ] Implement route handlers with a shared authenticated-mutation helper and raw InnerTube actions.
- [ ] Run focused tests, full proxy tests, typecheck, and `npm run check:cf -w @sonora-music/proxy`; expect PASS.
- [ ] Commit with `feat(proxy): add owned playlist editor routes`.

### Task 4: Mobile account API and state policy

**Files:**
- Modify: `apps/mobile/src/api/types.ts`
- Modify: `apps/mobile/src/api/client.ts`
- Create: `apps/mobile/src/account/songLikes.ts`
- Create: `apps/mobile/src/account/songLikesPolicy.ts`
- Create: `apps/mobile/src/account/songLikesPolicy.test.ts`

**Interfaces:**
- Produces: `setSongLiked(videoId: string, liked: boolean): Promise<SongLibraryState>`.
- Produces: playlist API methods matching Task 3.
- Produces: `getSongLike(videoId)`, `setSongLikeOptimistic(videoId, liked)`, `subscribeSongLikes(listener)` with rollback tokens.

- [ ] Write failing policy tests for unknown/liked/unliked state, optimistic rollback, and stale response ordering.
- [ ] Run the test with `node --import tsx --test apps/mobile/src/account/songLikesPolicy.test.ts`; expect missing-module failure.
- [ ] Add API types/functions and the session store; keep cookie handling centralized in `request`.
- [ ] Run policy tests and `cd apps/mobile; npx tsc --noEmit`; expect PASS.
- [ ] Commit with `feat(mobile): add account mutation clients`.

### Task 5: Reusable song actions and player Like control

**Files:**
- Create: `apps/mobile/src/components/SongActionsSheet.tsx`
- Modify: `apps/mobile/src/components/TrackRow.tsx`
- Modify: `apps/mobile/src/components/player/FullPlayerModal.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Modify: `apps/mobile/src/screens/BrowseScreen.tsx`

**Interfaces:**
- Consumes: `setSongLiked` and song-like store from Task 4.
- Produces: a single actions surface with Like/Unlike and existing queue operations.

- [ ] Add component tests or extract a pure action-state policy test covering unknown state, busy state, rollback, and `401` copy.
- [ ] Run the test; expect failure.
- [ ] Implement the actions sheet and full-player heart control with accessibility selected/busy state; wire every song surface through it.
- [ ] Run tests and mobile typecheck; expect PASS.
- [ ] Verify on Android: like/unlike from search, browse, and player; offline rollback; missing-cookie message; no duplicate submissions.
- [ ] Commit with `feat(mobile): add song like controls`.

### Task 6: Owned playlist editor UI

**Files:**
- Create: `apps/mobile/src/components/playlist/EditPlaylistDialog.tsx`
- Create: `apps/mobile/src/components/playlist/AddPlaylistItemsDialog.tsx`
- Create: `apps/mobile/src/components/playlist/OwnedPlaylistEditor.tsx`
- Create: `apps/mobile/src/components/playlist/playlistEditorPolicy.ts`
- Create: `apps/mobile/src/components/playlist/playlistEditorPolicy.test.ts`
- Modify: `apps/mobile/src/screens/BrowseScreen.tsx`

**Interfaces:**
- Consumes: editable browse state and mutation methods from Tasks 1, 3, and 4.
- Produces: serialized `enqueuePlaylistMutation(operation): Promise<void>` and authoritative reload after each structural mutation.

- [ ] Write failing policy tests for duplicate videos, exact token removal, reorder index calculation, serialized operations, and rollback/reload decisions.
- [ ] Run the policy test; expect missing-module failure.
- [ ] Implement metadata dialog, add current/search result flow, drag reorder, swipe/remove, destructive delete confirmation, and owner-only controls.
- [ ] Run policy tests and mobile typecheck; expect PASS.
- [ ] Verify on Android end to end: create playlist, edit metadata/privacy, add duplicate song entries, reorder one, remove the exact one, delete playlist, and confirm external playlist controls remain unchanged.
- [ ] Run full proxy test/typecheck/Workers dry-run and mobile typecheck.
- [ ] Commit with `feat(mobile): add owned playlist editor`.
