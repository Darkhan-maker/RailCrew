import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { authApi } from '@/services/api.service';
import { useAuthStore } from '@/store/auth.store';
import { LoginDtoSchema } from '@railcrew/contracts';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth, setDemoMode } = useAuthStore();

  async function handleLogin() {
    const result = LoginDtoSchema.safeParse({ email, password });
    if (!result.success) {
      Alert.alert('Ошибка', 'Заполните все поля корректно');
      return;
    }
    setLoading(true);
    try {
      const response = await authApi.login(result.data);
      await setAuth(response);
      router.replace('/(tabs)');
    } catch (e: unknown) {
      const isNetwork = !!(e as any)?.request && !(e as any)?.response;
      Alert.alert('Ошибка', isNetwork ? 'Сервер недоступен. Проверьте подключение.' : 'Неверный email или пароль');
    } finally {
      setLoading(false);
    }
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'https://railcrewapi-production.up.railway.app/api/v1';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0f172a' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView
      contentContainerStyle={s.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.title}>RailCrew</Text>
      <Text style={s.subtitle}>Учет поездок и зарплаты</Text>
      <Text style={s.apiHint} numberOfLines={1}>API: {apiUrl}</Text>

      <TextInput
        style={s.input}
        placeholder="Email"
        placeholderTextColor="#64748b"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={s.input}
        placeholder="Пароль"
        placeholderTextColor="#64748b"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={loading}>
        <Text style={s.btnText}>{loading ? 'Входим...' : 'Войти'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
        <Text style={s.link}>Нет аккаунта? Зарегистрироваться</Text>
      </TouchableOpacity>

      <View style={s.dividerRow}>
        <View style={s.dividerLine} />
        <Text style={s.dividerLabel}>или</Text>
        <View style={s.dividerLine} />
      </View>

      <TouchableOpacity
        style={s.demoBtn}
        onPress={async () => {
          await setDemoMode();
          router.replace('/(tabs)');
        }}
      >
        <Text style={s.demoBtnText}>Продолжить без входа</Text>
      </TouchableOpacity>
      <Text style={s.demoHint}>Данные сохраняются только на устройстве</Text>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', padding: 24 },
  title: { color: '#f1f5f9', fontSize: 32, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  subtitle: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginBottom: 40 },
  input: {
    backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 10,
    padding: 14, marginBottom: 12, fontSize: 16,
  },
  btn: {
    backgroundColor: '#3b82f6', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8, marginBottom: 16,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#3b82f6', textAlign: 'center', fontSize: 14 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 24, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1e293b' },
  dividerLabel: { color: '#334155', fontSize: 13 },
  demoBtn: {
    borderWidth: 1, borderColor: '#334155', borderRadius: 10,
    padding: 14, alignItems: 'center',
  },
  demoBtnText: { color: '#64748b', fontSize: 14 },
  demoHint: { color: '#334155', fontSize: 12, textAlign: 'center', marginTop: 8 },
  apiHint: { color: '#1e3a5f', fontSize: 10, textAlign: 'center', marginBottom: 24 },
});
