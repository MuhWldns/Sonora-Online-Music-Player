import { registerRootComponent } from 'expo';

import App from './App';

// expo-audio needs no module-scope service registration; the player singleton
// lives in src/player/service.ts and is set up from App.tsx.
registerRootComponent(App);
