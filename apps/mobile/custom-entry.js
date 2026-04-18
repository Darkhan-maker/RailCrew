/**
 * Диагностический entry — перехватывает ошибку из renderRootComponent
 * и показывает её на экране вместо белого экрана.
 */
import { AppRegistry } from 'react-native';
import React from 'react';
import { View, Text, ScrollView } from 'react-native';

// Перехватчик глобальных ошибок — ставим до загрузки expo-router
const errors = [];
const origHandler = global.ErrorUtils?.getGlobalHandler?.();
if (global.ErrorUtils) {
  global.ErrorUtils.setGlobalHandler((err, isFatal) => {
    errors.push((isFatal ? '[FATAL] ' : '[ERR] ') + (err?.message || String(err)));
    if (origHandler) origHandler(err, isFatal);
  });
}

// Компонент, который показывает накопленные ошибки
function DiagScreen() {
  const [msgs, setMsgs] = React.useState([...errors]);
  React.useEffect(() => {
    const id = setInterval(() => setMsgs([...errors]), 500);
    return () => clearInterval(id);
  }, []);
  return React.createElement(ScrollView, {
    style: { flex: 1, backgroundColor: '#1a1a2e' },
    contentContainerStyle: { padding: 16, paddingTop: 60 },
  },
    React.createElement(Text, { style: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 12 } }, 'RailCrew Diag'),
    msgs.length === 0
      ? React.createElement(Text, { style: { color: '#4ade80', fontSize: 14 } }, 'Ошибок нет — Expo Router грузится...')
      : msgs.map((m, i) => React.createElement(Text, { key: i, style: { color: '#f87171', fontSize: 12, marginBottom: 8 } }, m))
  );
}

// Регистрируем НАШУ компоненту первой, до expo-router
AppRegistry.registerComponent('main', () => DiagScreen);

// Теперь пробуем загрузить expo-router — он перезапишет регистрацию
// Если упадёт — наш DiagScreen уже зарегистрирован и покажет ошибки
try {
  require('expo-router/entry');
} catch (e) {
  errors.push('[CRASH] expo-router/entry: ' + (e?.message || String(e)));
  // DiagScreen уже зарегистрирован — покажет ошибку
}
