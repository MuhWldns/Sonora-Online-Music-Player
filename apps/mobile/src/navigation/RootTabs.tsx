/**
 * Root tab navigation: Home / Search / Library / Settings + Material icons,
 * with the global player chrome docked above the tab bar.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View } from 'react-native';

import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { PlayerChrome } from '../components/PlayerChrome';
import { HomeScreen } from '../screens/HomeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ACCENT } from '../theme';
import type { Palette } from '../theme';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, IconName> = {
  Home: 'home',
  Search: 'search',
  Library: 'library-music',
  Settings: 'settings',
};

export function RootTabs({ palette }: { palette: Palette }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: ACCENT,
          tabBarInactiveTintColor: palette.textSecondary,
          tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.outline },
          tabBarIcon: ({ color, size }) => (
            <Icon name={TAB_ICONS[route.name] ?? 'help-outline'} size={size} color={color} />
          ),
        })}
      >
        <Tab.Screen name="Home">
          {() => <HomeScreen palette={palette} />}
        </Tab.Screen>
        <Tab.Screen name="Search">
          {() => <SearchScreen palette={palette} />}
        </Tab.Screen>
        <Tab.Screen name="Library">
          {() => <LibraryScreen palette={palette} />}
        </Tab.Screen>
        <Tab.Screen name="Settings">
          {() => <SettingsScreen palette={palette} />}
        </Tab.Screen>
      </Tab.Navigator>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 80 }}>
        <PlayerChrome palette={palette} />
      </View>
    </View>
  );
}
