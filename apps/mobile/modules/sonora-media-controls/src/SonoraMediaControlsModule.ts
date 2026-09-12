import { NativeModule, requireNativeModule } from 'expo';

export type NativeTrack = {
  id: string;
  url: string;
  title: string;
  artist: string;
  artwork?: string;
};

export type PlaybackStatus = {
  index: number;
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  error?: string;
};

type MediaControlEvents = {
  statusChanged(event: PlaybackStatus): void;
};

declare class SonoraMediaControlsModule extends NativeModule<MediaControlEvents> {
  setup(): Promise<void>;
  replaceQueue(tracks: NativeTrack[], startIndex: number): Promise<void>;
  appendTracks(tracks: NativeTrack[]): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  skipTo(index: number): Promise<void>;
  seekTo(seconds: number): Promise<void>;
}

export default requireNativeModule<SonoraMediaControlsModule>('SonoraMediaControls');
