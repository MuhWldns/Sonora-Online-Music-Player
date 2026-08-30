import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar, useColorScheme } from 'react-native';

import { RootTabs } from './src/navigation/RootTabs';
import { setupPlayer } from './src/player/service';
import { darkPalette, lightPalette, navDarkTheme, navLightTheme } from './src/theme';

export default function App() {
  const [ready, setReady] = useState(false);
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const palette = dark ? darkPalette : lightPalette;

  useEffect(() => {
    setupPlayer()
      .then(() => setReady(true))
      .catch(() => setReady(true)); // player already set up (hot reload)
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <NavigationContainer theme={dark ? navDarkTheme : navLightTheme}>
        {ready ? <RootTabs palette={palette} /> : null}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
