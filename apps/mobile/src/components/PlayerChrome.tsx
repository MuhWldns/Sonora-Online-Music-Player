/**
 * Global playback chrome coordinator.
 *
 * Coordinates playback UI between the floating Apple Glass mini-player capsule
 * docked above the tab bar and the fullscreen glass player modal.
 *
 * Architecture:
 * - Docked mini-player: floating capsule anchored above RootTabs navigation bar,
 *   displaying track art, metadata, playback controls, and progress line.
 * - Full player modal: slide-up sheet displaying album artwork, queue editor,
 *   and synchronized animated lyrics.
 * - State management: coordinates sheet presentation (modalOpen) while delegating
 *   audio playback control to the player service.
 *
 * Invariants:
 * 1. Store decoupling: PlayerChrome only observes whether an active track exists.
 *    Fine-grained playback updates (currentTime, duration, buffering) stay scoped
 *    inside MiniPlayer and FullPlayerModal to avoid needless coordinator re-renders.
 * 2. Gesture isolation: MiniPlayer wraps controls in nested touch targets so play/next
 *    taps never inadvertently trigger the capsule expand gesture.
 * 3. Modal lifecycle: FullPlayerModal renders a native modal sheet with hardware back
 *    and swipe-down dismissal, resolving internal view stacks before closing.
 * 4. Surface transparency: The coordinator container passes through non-capsule touches
 *    via pointerEvents="box-none", preserving scroll and tap responsiveness in views
 *    docked underneath.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePlayerState } from '../player/usePlayerState';
import type { Palette } from '../theme';
import { FullPlayerModal } from './player/FullPlayerModal';
import { MiniPlayer } from './player/MiniPlayer';

export interface PlayerChromeProps {
  /** Active color palette for theming. */
  palette: Palette;
}

/**
 * Docked playback chrome: renders the floating mini-player capsule above the
 * tab bar and coordinates presentation of the full-screen player modal.
 */
export function PlayerChrome({ palette }: PlayerChromeProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // Subscribe only to whether an active track exists in the queue.
  const hasTrack = usePlayerState((s) => s.index >= 0 && s.index < s.queue.length);

  if (!hasTrack) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.container}>
      <MiniPlayer
        palette={palette}
        onExpand={() => setModalOpen(true)}
      />
      {modalOpen ? (
        <FullPlayerModal
          palette={palette}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Allows touches outside the mini-player capsule to pass through
    // to underlying screens while keeping the capsule anchored.
    width: '100%',
  },
});

export { MiniPlayer, FullPlayerModal };
export type { MiniPlayerProps } from './player/MiniPlayer';
