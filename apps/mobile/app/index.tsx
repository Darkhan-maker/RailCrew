import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { tokenStorage } from '@/services/storage.service';
import { useAuthStore } from '@/store/auth.store';

export default function Index() {
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => {
    async function init() {
      const token = await tokenStorage.get();
      if (token) {
        await rehydrate();
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    }
    init();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#3b82f6" />
    </View>
  );
}
