import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { authApi } from '@/services/api.service';
import { useAuthStore } from '@/store/auth.store';
import { RegisterDtoSchema, UserRole } from '@railcrew/contracts';
import { useLang } from '@/i18n';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<UserRole>('DRIVER');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const { t } = useLang();

  const ROLES: { label: string; value: UserRole }[] = [
    { label: t.register_roleDriver, value: 'DRIVER' },
    { label: t.register_roleAssistant, value: 'ASSISTANT' },
  ];

  async function handleRegister() {
    const result = RegisterDtoSchema.safeParse({ email, password, firstName, lastName, role });
    if (!result.success) {
      Alert.alert(t.common_error, t.register_errFill);
      return;
    }
    setLoading(true);
    try {
      const response = await authApi.register(result.data);
      await setAuth(response);
      router.replace('/(tabs)');
    } catch (e: unknown) {
      const isNetwork = !!(e as any)?.request && !(e as any)?.response;
      Alert.alert(t.common_error, isNetwork ? t.register_errNetwork : t.register_errEmail);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Text style={s.title}>{t.register_title}</Text>

      <TextInput style={s.input} placeholder={t.register_firstName} placeholderTextColor="#64748b"
        value={firstName} onChangeText={setFirstName} />
      <TextInput style={s.input} placeholder={t.register_lastName} placeholderTextColor="#64748b"
        value={lastName} onChangeText={setLastName} />
      <TextInput style={s.input} placeholder="Email" placeholderTextColor="#64748b"
        autoCapitalize="none" keyboardType="email-address"
        value={email} onChangeText={setEmail} />
      <TextInput style={s.input} placeholder={t.register_password}
        placeholderTextColor="#64748b" secureTextEntry
        value={password} onChangeText={setPassword} />

      <Text style={s.label}>{t.register_role}</Text>
      <View style={s.roleRow}>
        {ROLES.map((r) => (
          <TouchableOpacity
            key={r.value}
            style={[s.roleBtn, role === r.value && s.roleBtnActive]}
            onPress={() => setRole(r.value)}
          >
            <Text style={[s.roleBtnText, role === r.value && s.roleBtnTextActive]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={s.btn} onPress={handleRegister} disabled={loading}>
        <Text style={s.btnText}>{loading ? t.register_submitting : t.register_submit}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={s.link}>{t.register_hasAccount}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#0f172a', justifyContent: 'center', padding: 24 },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 32 },
  input: {
    backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 10,
    padding: 14, marginBottom: 12, fontSize: 16,
  },
  label: { color: '#94a3b8', fontSize: 14, marginBottom: 8 },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  roleBtn: {
    flex: 1, padding: 12, borderRadius: 10, borderWidth: 1,
    borderColor: '#334155', alignItems: 'center',
  },
  roleBtnActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  roleBtnText: { color: '#94a3b8', fontSize: 14 },
  roleBtnTextActive: { color: '#fff', fontWeight: '600' },
  btn: {
    backgroundColor: '#3b82f6', borderRadius: 10, padding: 16,
    alignItems: 'center', marginBottom: 16,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#3b82f6', textAlign: 'center', fontSize: 14 },
});
