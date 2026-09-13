# Playback Queue Editor

**Status:** shipped in 1.3.0
**Surface:** full player → queue view (`PlayerChrome` `QueueEditor`)
**Native bridge:** `sonora-media-controls` (Android, Media3 1.9.0)

The queue view turns the read-only "up next" list into an editable one. Three
gestures are supported, all operating on the live Media3 timeline rather than a
detached copy:

- **Reorder** — drag an upcoming track by its handle to a new position.
- **Remove** — swipe an upcoming track to the right past the reveal threshold.
- **Add** — long-press a catalog row and choose *Play next* or *Add to end*.

The currently playing track is pinned: it is rendered in its own "Sedang
diputar" row, is never draggable, and is never removable.

## Editable region

Indices are absolute positions in the JS queue. The editable region is every
index **strictly after** the current one:

```
editable(i)  ⇔  i > state.index  and  i < state.queue.length
```

Because the current track never moves and never disappears, `state.index` stays
stable across every reorder and removal, and the JS array stays trivially
aligned with the native Media3 timeline.

Reordering is disabled while shuffle is on: under shuffle the native playback
order is not the JS array order, so a positional move would not mean what the
user sees. The queue view shows an explicit notice instead.

## Index semantics (native ↔ JS)

All three operations are mirrored exactly, so the two queues cannot drift:

- **Move** uses Media3 semantics: `moveMediaItem(from, to)` treats `to` as the
  destination index *after* the item is lifted out, which is the same contract
  as `List.move` / `Util.moveItems`. The JS mirror is
  `splice(from, 1)` followed by `splice(to, 0, moved)`, which is equivalent.
- **Remove** removes the same index natively and in JS.
- **Add next** resolves its insertion point from the **live native current
  item** (`insertTracksAfterCurrent` returns the index used), so a stale JS
  index cannot land the insert in the wrong slot after a backgrounded
  auto-advance. The JS queue splices at the returned index.
- **Add to end** truly appends (`appendTracks`), never inserting before the
  current track.

Out-of-range indices are rejected natively with an error instead of being
silently clamped to an unrelated position. A rejected native call leaves both
queues untouched; the UI reports failure and the swipe affordance springs back.

## Current-track protection

Removing the playing item would silently advance playback. Both layers refuse
it:

- JS rejects any index `<= state.index` before calling native.
- Native rejects `index == currentMediaItemIndex` as well as any out-of-range
  index.

The result is that the user can only reorder or remove items that have not yet
started playing.

## Live playback is preserved

Adding to the queue must not interrupt the current track. The current item id
and playback position are unchanged across add-next and add-end; only the queue
length grows. Under the hood the tracks are appended/inserted into the existing
Media3 playlist rather than replacing it, so playback is not restarted.

## Accessibility

Every row exposes actions beyond the touch gestures, so the queue is fully
usable with a screen reader:

- The drag handle exposes `increment` ("Turunkan") and `decrement`
  ("Naikkan") actions, and is marked disabled while shuffle is on.
- The row exposes a `delete` action ("Hapus dari antrean").
- Moves and removals announce the resulting position/track via
  `AccessibilityInfo.announceForAccessibility`.

## Verification

- Queue mutation semantics are covered by a native-semantics simulation harness
  (reorder, remove, add-next, add-end, and rejection paths).
- On-device: drag reorder, swipe removal, add-next, and add-end were exercised
  against a live Media3 session; the current item id and playback position were
  observed to remain unchanged throughout, and the added track landed in the
  expected slot (immediately after the current track for add-next, at the true
  end for add-end).

## Related

- `docs/audio-playback-incident.md` — playback startup, range relaying, and the
  serialized queue-mutation fix that this feature builds on.
