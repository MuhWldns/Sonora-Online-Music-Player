/**
 * Root tab navigation: Home / Search / Library / Settings.
 * Fase 2 dari design plan — Search/Library/Settings screens menyusul
 * (fase 4 & 6); slot tab sudah terpasang supaya struktur final stabil.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { HomeScreen } from '../screens/HomeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ACCENT } from '../theme';

const Tab = createBottomTabNavigator();

export function RootTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: ACCENT }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
