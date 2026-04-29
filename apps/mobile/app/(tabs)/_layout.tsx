import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Home, List, PlusCircle, Settings, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLang } from '@/i18n';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const tabBarHeight = 60 + bottomPad;
  const { t } = useLang();
  const { theme } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.bg,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: bottomPad,
          height: tabBarHeight,
          elevation: 0,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMute,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.nav_summary,
          tabBarIcon: ({ color, focused }) => (
            <Home size={24} color={focused ? theme.primary : theme.textMute} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: t.nav_trips,
          tabBarIcon: ({ color, focused }) => (
            <List size={24} color={focused ? theme.primary : theme.textMute} />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: t.nav_add,
          tabBarIcon: ({ focused }) => (
            <View style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: -20,
              shadowColor: theme.primary,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 8,
              elevation: 8,
            }}>
              <PlusCircle size={28} color="#fff" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t.nav_settings,
          tabBarIcon: ({ color, focused }) => (
            <Settings size={24} color={focused ? theme.primary : theme.textMute} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.nav_profile,
          tabBarIcon: ({ color, focused }) => (
            <User size={24} color={focused ? theme.primary : theme.textMute} />
          ),
        }}
      />
    </Tabs>
  );
}
