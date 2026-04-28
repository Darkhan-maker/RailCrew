import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { authApi } from '@/services/api.service';
import { useAuthStore } from '@/store/auth.store';
import { RegisterDtoSchema, UserRole } from '@railcrew/contracts';
import { useLang } from '@/i18n';
import { useTheme } from '@/theme';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<UserRole>('DRIVER');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const { t } = useLang();
  const { theme } = useTheme();

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
    <ScrollView
      contentContainerStyle={[s.container, { backgroundColor: theme.bg }]}
    >
      <Text style={[s.title, { color: theme.text }]}>{t.register_title}</Text>

      <TextInput style={[s.input, { backgroundColor: theme.card, color: theme.text }]}
        placeholder={t.register_firstName} placeholderTextColor={theme.textMute}
        value={firstName} onChangeText={setFirstName} />
      <TextInput style={[s.input, { backgroundColor: theme.card, color: theme.text }]}
        placeholder={t.register_lastName} placeholderTextColor={theme.textMute}
        value={lastName} onChangeText={setLastName} />
      <TextInput style={[s.input, { backgroundColor: theme.card, color: theme.text }]}
        placeholder="Email" placeholderTextColor={theme.textMute}
        autoCapitalize="none" keyboardType="email-address"
        value={email} onChangeText={setEmail} />
      <TextInput style={[s.input, { backgroundColor: theme.card, color: theme.text }]}
        placeholder={t.register_password}
        placeholderTextColor={theme.textMute} secureTextEntry
        value={password} onChangeText={setPassword} />

      <Text style={[s.label, { color: theme.textDim }]}>{t.register_role}</Text>
      <View style={s.roleRow}>
        {ROLES.map((r) => (
          <TouchableOpacity
            key={r.value}
            style={[
              s.roleBtn,
              { borderColor: theme.border },
              role === r.value && { backgroundColor: theme.primary, borderColor: theme.primary },
            ]}
            onPress={() => setRole(r.value)}
          >
            <Text style={[
              s.roleBtnText,
              { color: theme.textDim },
              role === r.value && { color: '#fff', fontWeight: '600' },
            ]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[s.btn, { backgroundColor: theme.primary }]}
        onPress={handleRegister}
        disabled={loading}
      >
        <Text style={s.btnText}>{loading ? t.register_submitting : t.register_submit}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={[s.link, { color: theme.primary }]}>{t.register_hasAccount}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 32 },
  input: {
    borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16,
  },
  label: { fontSize: 14, marginBottom: 8 },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  roleBtn: {
    flex: 1, padding: 12, borderRadius: 10, borderWidth: 1,
    alignItems: 'center',
  },
  roleBtnText: { fontSize: 14 },
  btn: {
    borderRadius: 10, padding: 16,
    alignItems: 'center', marginBottom: 16,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { textAlign: 'center', fontSize: 14 },
});
