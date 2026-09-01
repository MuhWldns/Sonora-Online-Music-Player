import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { BrowseScreen } from '../screens/BrowseScreen';
import type { Palette } from '../theme';
import { RootTabs } from './RootTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator({ palette }: { palette: Palette }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs">
        {() => <RootTabs palette={palette} />}
      </Stack.Screen>
      <Stack.Screen name="Browse">
        {(props) => <BrowseScreen {...props} palette={palette} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
