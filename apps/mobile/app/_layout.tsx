import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { LangProvider } from '@/i18n';
import { ThemeProvider } from '@/theme';

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
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font });
  const [timedOut, setTimedOut] = useState(false);

  const ready = fontsLoaded || !!fontError || timedOut;

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <LangProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </LangProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
