import TrackPlayer from 'react-native-track-player';

import { registerRootComponent } from 'expo';

import App from './App';
import { playbackService } from './src/player/service';

// Playback service must be registered at module scope, before the app renders,
// so remote events (notification controls, queue end) reach it.
TrackPlayer.registerPlaybackService(() => playbackService);

registerRootComponent(App);
