export interface ReleasablePlayer {
  pause(): void;
  remove(): void;
  release(): void;
}

export function stopAndReleasePlayer(player: ReleasablePlayer): void {
  player.pause();
  player.remove();
  player.release();
}
