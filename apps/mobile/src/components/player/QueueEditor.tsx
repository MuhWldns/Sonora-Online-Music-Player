/**
 * Queue editor sheet: pinned current track, then the editable upcoming list
 * with vertical drag reorder and swipe-right removal. Moved out of
 * PlayerChrome; all gesture invariants (uniform slots, ref-held handlers,
 * rubber-band swipe, native-move hold) are preserved unchanged.
 */
import { useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { glass, radius, spacing, TOUCH_TARGET, typeScale } from '../../theme';
import type { Palette } from '../../theme';
import { Icon } from '../Icon';
import {
  moveQueueItem,
  playAt,
  removeQueueItem,
} from '../../player/service';
import type { PlayerTrack } from '../../player/service';

/** Fixed row height keeps drag math exact (uniform slots: index = dy / height). */
const QUEUE_ROW_HEIGHT = 64;
/** How far right a row travels to fully reveal the delete action. */
const SWIPE_REVEAL = 96;
/** Past this horizontal distance, release removes the track. */
const SWIPE_THRESHOLD = 88;
/** Auto-scroll when a drag comes within this distance of the list edge. */
const DRAG_EDGE = 72;
const DRAG_AUTO_SCROLL_STEP = 10;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The pinned "Sedang diputar" track. Never draggable, never removable. */
function NowPlayingRow({
  track,
  playing,
  palette,
}: {
  track: PlayerTrack;
  playing: boolean;
  palette: Palette;
}) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Sedang diputar: ${track.title} oleh ${track.artist}`}
      style={[
        styles.nowRow,
        {
          backgroundColor: glass.surface,
          borderColor: glass.border,
        },
      ]}
    >
      <Image source={{ uri: track.thumbnail ?? undefined }} style={styles.qThumb} />
      <View style={styles.qMeta}>
        <Text numberOfLines={1} style={[styles.qTitle, { color: palette.accentText }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={[styles.qSub, { color: palette.textSecondary }]}>
          {track.artist}
        </Text>
      </View>
      <Icon name={playing ? 'graphic-eq' : 'play-arrow'} size={20} color={palette.accentText} />
    </View>
  );
}

/** One editable upcoming track: drag handle reorders, swipe right removes, tap
 * plays. All gesture callbacks live in a ref so a mid-gesture re-render (hover
 * index changing) never swaps the active PanResponder. */
function UpcomingRow({
  track,
  index,
  palette,
  canReorder,
  isDragging,
  dragY,
  shiftY,
  onPlay,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onMoveBy,
  onRemove,
}: {
  track: PlayerTrack;
  index: number;
  palette: Palette;
  canReorder: boolean;
  isDragging: boolean;
  dragY: Animated.Value;
  shiftY: number;
  onPlay: () => void;
  onDragStart: (index: number) => void;
  onDragMove: (dy: number, moveY: number) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
  onMoveBy: (delta: number) => void;
  onRemove: () => Promise<boolean>;
}) {
  const swipeX = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(index);
  indexRef.current = index;
  const canReorderRef = useRef(canReorder);
  canReorderRef.current = canReorder;
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd, onDragCancel, onMoveBy, onRemove });
  handlers.current = { onDragStart, onDragMove, onDragEnd, onDragCancel, onMoveBy, onRemove };

  const swipe = useMemo(
    () =>
      PanResponder.create({
        // Claim only clearly rightward drags. Capture too, so the swipe can
        // take over from the inner Pressable (tap-to-play) once the gesture is
        // unmistakably horizontal; vertical drags still fall through to the
        // drag handle.
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          g.dx > 12 && g.dx > Math.abs(g.dy) * 1.4,
        onMoveShouldSetPanResponder: (_e, g) => g.dx > 12 && g.dx > Math.abs(g.dy) * 1.4,
        onPanResponderMove: (_e, g) => {
          if (g.dx <= 0) {
            swipeX.setValue(0);
            return;
          }
          // Rubber-band past the reveal width so the row never runs away.
          swipeX.setValue(
            g.dx <= SWIPE_REVEAL ? g.dx : SWIPE_REVEAL + (g.dx - SWIPE_REVEAL) * 0.35,
          );
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dx >= SWIPE_THRESHOLD) {
            Animated.timing(swipeX, {
              toValue: 480,
              duration: 180,
              useNativeDriver: true,
            }).start(async ({ finished }) => {
              if (!finished) return;
              // Native failure: spring back so the row cannot vanish silently.
              const removed = await handlers.current.onRemove();
              if (!removed) {
                Animated.spring(swipeX, {
                  toValue: 0,
                  bounciness: 8,
                  useNativeDriver: true,
                }).start();
              }
            });
          } else {
            Animated.spring(swipeX, { toValue: 0, bounciness: 8, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [swipeX],
  );

  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canReorderRef.current,
        onMoveShouldSetPanResponder: () => canReorderRef.current,
        onPanResponderGrant: () => handlers.current.onDragStart(indexRef.current),
        onPanResponderMove: (_e, g) => handlers.current.onDragMove(g.dy, g.moveY),
        onPanResponderRelease: () => handlers.current.onDragEnd(),
        onPanResponderTerminate: () => handlers.current.onDragCancel(),
      }),
    [],
  );

  const deleteOpacity = swipeX.interpolate({
    inputRange: [0, SWIPE_REVEAL * 0.5, SWIPE_REVEAL],
    outputRange: [0, 0.6, 1],
    extrapolate: 'clamp',
  });
  const deleteScale = swipeX.interpolate({
    inputRange: [0, SWIPE_THRESHOLD, SWIPE_REVEAL],
    outputRange: [0.85, 1, 1.12],
    extrapolate: 'clamp',
  });

  // Animate the reorder preview instead of snapping between slots.
  const shiftAnim = useRef(new Animated.Value(0)).current;
  const shiftTarget = isDragging ? 0 : shiftY;
  const shiftRef = useRef(shiftTarget);
  if (shiftRef.current !== shiftTarget) {
    shiftRef.current = shiftTarget;
    Animated.timing(shiftAnim, {
      toValue: shiftTarget,
      duration: 140,
      useNativeDriver: true,
    }).start();
  }
  const translateY = isDragging ? dragY : shiftAnim;

  return (
    <Animated.View
      style={[
        styles.qRowWrap,
        {
          transform: [{ translateY }],
          zIndex: isDragging ? 2 : 0,
          elevation: isDragging ? 4 : 0,
        },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.qDeleteBg, { backgroundColor: palette.errorContainer, opacity: deleteOpacity }]}
      >
        <Animated.View
          style={[
            styles.qDeleteInner,
            { opacity: deleteOpacity, transform: [{ scale: deleteScale }] },
          ]}
        >
          <Icon name="delete-outline" size={22} color={palette.onErrorContainer} />
          <Text style={[styles.qDeleteLabel, { color: palette.onErrorContainer }]}>Hapus</Text>
        </Animated.View>
      </Animated.View>

      <Animated.View
        {...swipe.panHandlers}
        style={[
          styles.qRow,
          {
            backgroundColor: isDragging ? glass.surfaceActive : glass.surfaceSubtle,
            transform: [{ translateX: swipeX }],
          },
        ]}
      >
        <View
          {...drag.panHandlers}
          accessible
          accessibilityRole="button"
          accessibilityState={{ disabled: !canReorder }}
          accessibilityLabel={`Ubah urutan ${track.title}`}
          accessibilityHint={
            canReorder
              ? 'Tahan lalu geser. Aksi Naikkan dan Turunkan juga tersedia.'
              : 'Matikan acak untuk mengubah urutan'
          }
          accessibilityActions={
            canReorder
              ? [
                  { name: 'decrement', label: 'Naikkan' },
                  { name: 'increment', label: 'Turunkan' },
                ]
              : []
          }
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === 'decrement') handlers.current.onMoveBy(-1);
            else if (action === 'increment') handlers.current.onMoveBy(1);
          }}
          style={[styles.qHandle, !canReorder && { opacity: 0.35 }]}
        >
          <Icon name="drag-indicator" size={24} color={palette.textSecondary} />
        </View>

        <Pressable
          onPress={onPlay}
          accessibilityRole="button"
          accessibilityLabel={`Putar ${track.title}`}
          accessibilityHint={`${track.artist}. Geser ke kanan untuk menghapus, atau pakai aksi Hapus.`}
          accessibilityActions={[{ name: 'delete', label: 'Hapus dari antrean' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'delete') handlers.current.onRemove();
          }}
          style={({ pressed }) => [styles.qRowMain, pressed && { opacity: 0.6 }]}
        >
          <Image source={{ uri: track.thumbnail ?? undefined }} style={styles.qThumb} />
          <View style={styles.qMeta}>
            <Text numberOfLines={1} style={[styles.qTitle, { color: palette.text }]}>
              {track.title}
            </Text>
            <Text numberOfLines={1} style={[styles.qSub, { color: palette.textSecondary }]}>
              {track.artist}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/** Queue sheet: pinned current track, then the editable upcoming list with
 * vertical drag reorder and swipe-right removal. */
export function QueueEditor({
  queue,
  index,
  playing,
  shuffle,
  palette,
  bottomInset,
}: {
  queue: PlayerTrack[];
  index: number;
  playing: boolean;
  shuffle: boolean;
  palette: Palette;
  bottomInset: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const viewportTopRef = useRef(0);
  const dragFromRef = useRef<number | null>(null);
  const dragScrolledRef = useRef(0);
  const hoverRef = useRef<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragVideoId, setDragVideoId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const current = queue[index];
  const firstUpcoming = index + 1;
  const upcoming = queue.slice(firstUpcoming);
  const lastIndex = queue.length - 1;
  const canReorder = !shuffle && upcoming.length > 1;

  function startDrag(fromIndex: number): void {
    if (shuffle) return;
    dragFromRef.current = fromIndex;
    dragScrolledRef.current = 0;
    hoverRef.current = fromIndex;
    dragY.setValue(0);
    setDragIndex(fromIndex);
    setDragVideoId(queue[fromIndex]?.videoId ?? null);
    setHoverIndex(fromIndex);
    viewportRef.current?.measureInWindow((_x, y) => {
      viewportTopRef.current = y;
    });
  }

  function updateDrag(dy: number, moveY: number): void {
    const from = dragFromRef.current;
    if (from === null) return;

    // Auto-scroll near the viewport edges; the scrolled distance is folded into
    // the effective offset so the row keeps tracking the finger.
    const top = viewportTopRef.current;
    const height = viewportHeightRef.current;
    const maxOffset = Math.max(0, contentHeightRef.current - height);
    let offset = scrollOffsetRef.current;
    if (moveY - top < DRAG_EDGE) offset -= DRAG_AUTO_SCROLL_STEP;
    else if (top + height - moveY < DRAG_EDGE) offset += DRAG_AUTO_SCROLL_STEP;
    offset = clampNumber(offset, 0, maxOffset);
    const scrolled = offset - scrollOffsetRef.current;
    if (scrolled !== 0) {
      scrollOffsetRef.current = offset;
      dragScrolledRef.current += scrolled;
      scrollRef.current?.scrollTo({ y: offset, animated: false });
    }

    const effective = dy + dragScrolledRef.current;
    dragY.setValue(effective);
    const target = clampNumber(
      from + Math.round(effective / QUEUE_ROW_HEIGHT),
      firstUpcoming,
      lastIndex,
    );
    hoverRef.current = target;
    setHoverIndex((prev) => (prev === target ? prev : target));
  }

  function resetDrag(): void {
    dragFromRef.current = null;
    hoverRef.current = null;
    dragScrolledRef.current = 0;
    setDragIndex(null);
    setDragVideoId(null);
    setHoverIndex(null);
    dragY.setValue(0);
  }

  function endDrag(): void {
    const from = dragFromRef.current;
    const to = hoverRef.current;
    // No movement (or the drag never started): just release.
    if (from === null || to === null || from === to) {
      resetDrag();
      return;
    }
    const title = queue[from]?.title ?? '';
    // Hold the preview until the native move resolves, so the row never snaps
    // back to its old slot for a frame before the reordered queue renders.
    moveQueueItem(from, to).then((moved) => {
      resetDrag();
      if (moved) {
        AccessibilityInfo.announceForAccessibility(`${title} dipindah ke posisi ${to - index}`);
      }
    });
  }

  return (
    <View
      ref={viewportRef}
      style={styles.queueViewport}
      collapsable={false}
      onLayout={(e) => {
        viewportHeightRef.current = e.nativeEvent.layout.height;
        // Cache the absolute origin so drag auto-scroll has a baseline even
        // before the first measureInWindow callback lands.
        viewportRef.current?.measureInWindow((_x, y) => {
          viewportTopRef.current = y;
        });
      }}
    >
      <ScrollView
        ref={scrollRef}
        scrollEnabled={dragIndex === null}
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingBottom: bottomInset + 120 }}
      >
        <View
          onLayout={(e) => {
            contentHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          <Text style={[styles.queueSection, { color: palette.textSecondary }]}>
            Sedang diputar
          </Text>
          {current ? (
            <NowPlayingRow track={current} playing={playing} palette={palette} />
          ) : null}

          <View style={styles.queueNextHeader}>
            <Text
              style={[
                styles.queueSection,
                styles.queueSectionInline,
                { color: palette.textSecondary },
              ]}
            >
              Berikutnya
            </Text>
            {upcoming.length > 0 ? (
              <Text style={[styles.queueCount, { color: palette.textSecondary }]}>
                {upcoming.length} lagu
              </Text>
            ) : null}
          </View>

          {shuffle ? (
            <View
              style={[
                styles.queueNotice,
                { backgroundColor: glass.surface, borderColor: glass.border },
              ]}
            >
              <Icon name="shuffle" size={18} color={palette.textSecondary} />
              <Text style={[styles.queueNoticeText, { color: palette.textSecondary }]}>
                Matikan acak untuk mengubah urutan
              </Text>
            </View>
          ) : null}

          {upcoming.length === 0 ? (
            <Text style={[styles.queueEmpty, { color: palette.textSecondary }]}>
              Tidak ada lagu berikutnya
            </Text>
          ) : (
            upcoming.map((track, position) => {
              const absIndex = firstUpcoming + position;
              let shiftY = 0;
              if (dragIndex !== null && hoverIndex !== null) {
                if (absIndex > dragIndex && absIndex <= hoverIndex) shiftY = -QUEUE_ROW_HEIGHT;
                else if (absIndex < dragIndex && absIndex >= hoverIndex) shiftY = QUEUE_ROW_HEIGHT;
              }
              return (
                <UpcomingRow
                  key={`${track.videoId}-${absIndex}`}
                  track={track}
                  index={absIndex}
                  palette={palette}
                  canReorder={canReorder}
                  isDragging={track.videoId === dragVideoId}
                  dragY={dragY}
                  shiftY={shiftY}
                  onPlay={() => playAt(absIndex)}
                  onDragStart={startDrag}
                  onDragMove={updateDrag}
                  onDragEnd={endDrag}
                  onDragCancel={resetDrag}
                  onMoveBy={(delta) => {
                    const target = clampNumber(absIndex + delta, firstUpcoming, lastIndex);
                    if (target === absIndex) return;
                    moveQueueItem(absIndex, target).then((moved) => {
                      if (moved) {
                        AccessibilityInfo.announceForAccessibility(
                          `${track.title} dipindah ke posisi ${target - index}`,
                        );
                      }
                    });
                  }}
                  onRemove={() =>
                    removeQueueItem(absIndex).then((removed) => {
                      if (removed) {
                        AccessibilityInfo.announceForAccessibility(
                          `${track.title} dihapus dari antrean`,
                        );
                      }
                      return removed;
                    })
                  }
                />
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  queueViewport: { flex: 1 },
  queueSection: {
    fontSize: typeScale.label,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  queueNextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
  },
  queueSectionInline: { marginBottom: spacing.xs },
  queueCount: { fontSize: typeScale.small, marginTop: spacing.md, marginBottom: spacing.xs },
  queueNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  queueNoticeText: { fontSize: typeScale.label, flex: 1 },
  queueEmpty: {
    fontSize: typeScale.body,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  // Wrapper owns the translateY/depth so the row's own swipe translateX is
  // independent; height is fixed so drag math maps dy to slots exactly.
  qRowWrap: { height: QUEUE_ROW_HEIGHT, justifyContent: 'center' },
  qDeleteBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SWIPE_REVEAL,
    bottom: 0,
    // The row slides right, so the revealed strip is the LEFT edge.
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  qDeleteInner: {
    alignItems: 'center',
    justifyContent: 'center',
    width: SWIPE_REVEAL,
    height: '100%',
    gap: 2,
  },
  qDeleteLabel: { fontSize: typeScale.small, fontWeight: '700' },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: QUEUE_ROW_HEIGHT,
    paddingRight: spacing.md,
  },
  qHandle: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
  },
  nowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: QUEUE_ROW_HEIGHT,
  },
  qThumb: { width: 44, height: 44, borderRadius: 4 },
  qMeta: { flex: 1, gap: 2 },
  qTitle: { fontSize: typeScale.body, fontWeight: '600' },
  qSub: { fontSize: typeScale.label },
});
