# Search Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add search suggestions, pinned local history, persisted last filter, and contextual shortcuts into Search.

**Architecture:** A portable proxy route parses upstream suggestions. Mobile uses pure history/preferences policies, validated AsyncStorage stores, cancellable debounced requests, and typed navigation prefill parameters.

**Tech Stack:** TypeScript, Hono, React Native, React Navigation, AsyncStorage, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-personal-music-features-design.md`

## Global Constraints

- Suggestions use the request cookie when available but remain functional for anonymous users.
- Debounce is 200 ms and stale responses never replace newer input.
- Pinned queries remain above unpinned history and survive normal “Clear all.”
- Last filter persists locally.
- Context shortcuts prefill/focus Search and do not submit automatically.

## Review Focus

- Rapid typing and navigation away must abort or ignore stale suggestions.
- Case/whitespace variants must remain one history entry while preserving pin state.
- The history cap must never evict pinned entries before unpinned entries.
- Invalid persisted filters must fall back to “Semua.”
- Offline mode must still show matching pinned/recent local queries.

---

### Task 1: Suggestion parser and proxy route

**Files:**
- Create: `packages/proxy/src/search-suggestions.ts`
- Create: `packages/proxy/test/search-suggestions.test.ts`
- Modify: `packages/proxy/src/index.ts`

**Interfaces:**
- Produces: `parseSearchSuggestions(data): string[]`.
- Produces: `GET /search/suggestions?q=... -> { suggestions: string[] }`.

- [ ] Write failing parser/route tests for nested renderers, dedupe, whitespace, empty query, auth passthrough, cache scoping, and upstream failure.
- [ ] Run focused proxy test; expect missing route/module failure.
- [ ] Implement parser and route with a short query+account-scoped cache.
- [ ] Run focused/full proxy tests, typecheck, and Workers dry-run.
- [ ] Commit with `feat(proxy): add search suggestions`.

### Task 2: Pinned history policy and migration

**Files:**
- Modify: `apps/mobile/src/storage/searchDiscoveryPolicy.ts`
- Modify: `apps/mobile/src/storage/searchDiscoveryPolicy.test.ts`
- Modify: `apps/mobile/src/storage/searchHistory.ts`

**Interfaces:**
- Changes `SearchHistoryEntry` to `{ query, searchedAt, pinned }`.
- Produces: `pinSearchQuery`, `unpinSearchQuery`, `clearUnpinnedSearchHistory`, `clearAllSearchHistory`.

- [ ] Write failing tests for legacy migration, case-insensitive dedupe preserving pins, pinned-first ordering, unpinned cap/eviction, normal clear, full clear, and corrupt data.
- [ ] Run focused policy tests; expect failures.
- [ ] Implement policy/store migration with serialized writes.
- [ ] Run tests and mobile typecheck.
- [ ] Commit with `feat(search): add pinned local history`.

### Task 3: Last-filter preference

**Files:**
- Create: `apps/mobile/src/storage/searchPreferences.ts`
- Create: `apps/mobile/src/storage/searchPreferences.test.ts`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`

**Interfaces:**
- Produces: `SearchFilter = 'all'|'song'|'video'|'album'|'artist'|'playlist'`.
- Produces: `getLastSearchFilter()` and `setLastSearchFilter(filter)`.

- [ ] Write failing tests for round-trip, legacy undefined, invalid/corrupt values, and write failure fallback.
- [ ] Implement the validated store and restore filter before discovery rendering; map `all` to omitted proxy filter.
- [ ] Run tests and mobile typecheck.
- [ ] Commit with `feat(search): remember the last result filter`.

### Task 4: Suggestion client and local fallback policy

**Files:**
- Modify: `apps/mobile/src/api/types.ts`
- Modify: `apps/mobile/src/api/client.ts`
- Create: `apps/mobile/src/search/suggestionPolicy.ts`
- Create: `apps/mobile/src/search/suggestionPolicy.test.ts`
- Create: `apps/mobile/src/search/useSearchSuggestions.ts`

**Interfaces:**
- Produces: `searchSuggestions(q, signal)`.
- Produces: `mergeSuggestions(remote, history, input, limit)` and hook state `{ suggestions, loading }`.

- [ ] Write failing tests for 200 ms debounce with fake timers, request cancellation/generation guard, dedupe, pinned priority, local prefix/substring fallback, and empty input.
- [ ] Implement API, pure merge policy, and hook.
- [ ] Run tests and mobile typecheck.
- [ ] Commit with `feat(search): load resilient query suggestions`.

### Task 5: Search discovery and suggestion UI

**Files:**
- Create: `apps/mobile/src/components/search/SearchSuggestionsList.tsx`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: pin/unpin controls, separate clear-all confirmation, suggestion selection, and keyboard-safe list behavior.

- [ ] Extract/test a Search screen view-model for discovery/suggestions/results/error precedence.
- [ ] Implement pinned section, history actions, remote/local suggestions, and accessibility labels.
- [ ] Run tests and mobile typecheck.
- [ ] Verify on Android: rapid typing, stale response, offline fallback, pin/unpin, normal clear preserving pins, full clear confirmation, and restored filter.
- [ ] Commit with `feat(mobile): enrich search discovery`.

### Task 6: Typed contextual search shortcuts

**Files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootTabs.tsx`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Modify: `apps/mobile/src/screens/BrowseScreen.tsx`
- Modify: `apps/mobile/src/components/player/FullPlayerModal.tsx`
- Modify: `apps/mobile/src/components/SongActionsSheet.tsx` (created by the account-actions plan).
- Create: `apps/mobile/src/navigation/searchShortcutPolicy.ts`
- Create: `apps/mobile/src/navigation/searchShortcutPolicy.test.ts`

**Interfaces:**
- Produces: typed `SearchShortcut { query: string; filter?: SearchFilter; nonce: string }` carried to the Search tab.
- Search consumes each nonce once, prefills query/filter, focuses input, and does not submit.

- [ ] Write failing tests for artist, album/playlist, current-track shortcut construction, normalization, same-query repeated nonce, and no automatic history entry.
- [ ] Implement typed tab navigation params and shortcut actions on browse and player surfaces.
- [ ] Run tests and mobile typecheck.
- [ ] Verify every shortcut, Back/tab switching, repeated same query, and absence of history until submit.
- [ ] Run full proxy tests/typecheck/Workers dry-run and mobile typecheck.
- [ ] Commit with `feat(mobile): add contextual search shortcuts`.
