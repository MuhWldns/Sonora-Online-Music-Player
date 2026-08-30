import { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View } from 'react-native';

import { HomeScreen } from './src/screens/HomeScreen';
import { setupPlayer } from './src/player/service';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setupPlayer()
      .then(() => setReady(true))
      .catch(() => setReady(true)); // player already set up (hot reload)
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.content}>{ready ? <HomeScreen /> : null}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1 },
});
