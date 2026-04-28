import { Theme } from './types';

export const blueTheme: Theme = {
  key: 'blue',
  bg: '#0B0F14',
  card: '#192030',
  cardHi: '#1E2A3D',
  surface: '#111820',
  border: '#263245',
  text: '#E8EEF5',
  textDim: '#8A99AD',
  textMute: '#5B6A7E',
  primary: '#2472CC',
  primaryDark: '#1A5BA8',
  primaryDim: '#2472CC33',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

export const greenTheme: Theme = {
  key: 'green',
  bg: '#0B130F',
  card: '#192820',
  cardHi: '#1E3028',
  surface: '#111A15',
  border: '#263D2E',
  text: '#E8F5EE',
  textDim: '#8AAD96',
  textMute: '#5B7A68',
  primary: '#10B981',
  primaryDark: '#059669',
  primaryDim: '#10B98133',
  success: '#34D399',
  warning: '#F59E0B',
  danger: '#EF4444',
};

export const purpleTheme: Theme = {
  key: 'purple',
  bg: '#0D0B14',
  card: '#1E1930',
  cardHi: '#261E3D',
  surface: '#150F20',
  border: '#352645',
  text: '#EEE8F5',
  textDim: '#9D8AAD',
  textMute: '#6E5B7E',
  primary: '#8B5CF6',
  primaryDark: '#7C3AED',
  primaryDim: '#8B5CF633',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

export const orangeTheme: Theme = {
  key: 'orange',
  bg: '#140F0B',
  card: '#302019',
  cardHi: '#3D281E',
  surface: '#201510',
  border: '#453326',
  text: '#F5EEE8',
  textDim: '#AD9D8A',
  textMute: '#7E6E5B',
  primary: '#F59E0B',
  primaryDark: '#D97706',
  primaryDim: '#F59E0B33',
  success: '#10B981',
  warning: '#FBBF24',
  danger: '#EF4444',
};

export const THEMES: Record<string, Theme> = {
  blue: blueTheme,
  green: greenTheme,
  purple: purpleTheme,
  orange: orangeTheme,
};
