import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { View, Text, ScrollView } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';

SplashScreen.preventAutoHideAsync().catch(() => {});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <ScrollView style={{ flex: 1, backgroundColor: '#0f172a' }}
          contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
          <Text style={{ color: '#f87171', fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
            RENDER ERROR
          </Text>
          <Text style={{ color: '#fbbf24', fontSize: 13, marginBottom: 8 }}>
            {error.message}
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 10 }}>
            {(error.stack ?? '').slice(0, 2000)}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ ...Ionicons.font });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </ErrorBoundary>
  );
}
