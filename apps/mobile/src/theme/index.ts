import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme, ThemeKey } from './types';
import { blueTheme, THEMES } from './themes';

export * from './types';
export * from './themes';

const STORAGE_KEY = 'app_theme';

interface ThemeContextValue {
  themeKey: ThemeKey;
  setThemeKey: (key: ThemeKey) => Promise<void>;
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeKey: 'blue',
  setThemeKey: async () => {},
  theme: blueTheme,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>('blue');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored && stored in THEMES) {
        setThemeKeyState(stored as ThemeKey);
      }
    });
  }, []);

  async function setThemeKey(key: ThemeKey) {
    setThemeKeyState(key);
    await AsyncStorage.setItem(STORAGE_KEY, key);
  }

  return (
    <ThemeContext.Provider value={{ themeKey, setThemeKey, theme: THEMES[themeKey] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
