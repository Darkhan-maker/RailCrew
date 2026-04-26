import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ru } from './ru';
import { kk } from './kk';
import { Strings } from './types';

export type Lang = 'ru' | 'kk';
export type { Strings };

const LANG_KEY = 'app_language';

const strings: Record<Lang, Strings> = { ru, kk };

type LangContextValue = {
  lang: Lang;
  setLang: (l: Lang) => Promise<void>;
  t: Strings;
};

const LangContext = createContext<LangContextValue>({
  lang: 'ru',
  setLang: async () => {},
  t: ru,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ru');

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((stored) => {
      if (stored === 'ru' || stored === 'kk') setLangState(stored);
    });
  }, []);

  async function setLang(l: Lang) {
    setLangState(l);
    await AsyncStorage.setItem(LANG_KEY, l);
  }

  return React.createElement(
    LangContext.Provider,
    { value: { lang, setLang, t: strings[lang] } },
    children,
  );
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

export function pluralTrips(n: number, t: Strings): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return t.trip_1;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return t.trip_few;
  return t.trip_many;
}

export function fmtDur(minutes: number, t: Strings): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} ${t.hour_abbr} ${m} ${t.min_abbr}` : `${h} ${t.hour_abbr}`;
}
