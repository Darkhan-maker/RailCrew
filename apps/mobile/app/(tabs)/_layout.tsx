import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLang } from '@/i18n';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function icon(active: IoniconName, inactive: IoniconName, size = 22) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color} />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const tabBarHeight = 52 + bottomPad;
  const { t } = useLang();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0B0F14',
          borderTopColor: '#263245',
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: bottomPad,
          height: tabBarHeight,
          elevation: 0,
        },
        tabBarActiveTintColor: '#2472CC',
        tabBarInactiveTintColor: '#5B6A7E',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.nav_summary,
          tabBarIcon: icon('home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: t.nav_trips,
          tabBarIcon: icon('list', 'list-outline'),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: t.nav_add,
          tabBarIcon: icon('add-circle', 'add-circle-outline', 28),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t.nav_settings,
          tabBarIcon: icon('settings', 'settings-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.nav_profile,
          tabBarIcon: icon('person', 'person-outline'),
        }}
      />
    </Tabs>
  );
}
