import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { router } from 'expo-router';
import { tokenStorage } from '@/services/storage.service';
import { useAuthStore } from '@/store/auth.store';

export default function Index() {
  const rehydrate = useAuthStore((s) => s.rehydrate);
  const [status, setStatus] = useState('checking token...');

  useEffect(() => {
    async function init() {
      try {
        const token = await tokenStorage.get();
        setStatus(token ? 'token found, rehydrating...' : 'no token → login');
        if (token) {
          await rehydrate();
          setStatus('navigating → tabs');
          router.replace('/(tabs)');
        } else {
          router.replace('/(auth)/login');
        }
      } catch (e: unknown) {
        setStatus('ERROR: ' + String(e));
      }
    }
    init();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#3b82f6" />
      <Text style={{ color: '#64748b', marginTop: 16, fontSize: 13 }}>{status}</Text>
    </View>
  );
}
