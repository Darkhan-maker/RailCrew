import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, Profile, AuthResponse } from '@railcrew/contracts';
import { tokenStorage } from '../services/storage.service';

const USER_KEY = 'auth_user';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  setAuth: (response: AuthResponse) => Promise<void>;
  setDemoMode: () => Promise<void>;
  rehydrate: () => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  isAuthenticated: false,

  setDemoMode: async () => {
    const now = new Date();
    const demoUser: User = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'demo@railcrew.local',
      role: 'DRIVER',
      createdAt: now,
      updatedAt: now,
    };
    const demoProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000002',
      userId: demoUser.id,
      firstName: 'Демо',
      lastName: 'Пользователь',
      createdAt: now,
      updatedAt: now,
    };
    await tokenStorage.set('demo_mode_token');
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ user: demoUser, profile: demoProfile }));
    set({ user: demoUser, profile: demoProfile, isAuthenticated: true });
  },

  setAuth: async (response: AuthResponse) => {
    await tokenStorage.set(response.accessToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ user: response.user, profile: response.profile }));
    set({ user: response.user, profile: response.profile, isAuthenticated: true });
  },

  rehydrate: async () => {
    const raw = await AsyncStorage.getItem(USER_KEY);
    if (!raw) return false;
    const { user, profile } = JSON.parse(raw) as { user: User; profile: Profile };
    set({ user, profile, isAuthenticated: true });
    return true;
  },

  logout: async () => {
    await tokenStorage.remove();
    await AsyncStorage.removeItem(USER_KEY);
    set({ user: null, profile: null, isAuthenticated: false });
  },
}));
