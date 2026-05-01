import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { http } from '@/services/api.service';
import { tokenStorage } from '@/services/storage.service';
import { UpdateProfileDtoSchema, UpdateProfileDto } from '@railcrew/contracts';
import { useLang } from '@/i18n';
import { useTheme } from '@/theme';

function getInitials(first?: string | null, last?: string | null): string {
  const f = first?.trim()[0]?.toUpperCase() ?? '';
  const l = last?.trim()[0]?.toUpperCase() ?? '';
  return (f + l) || '?';
}

export default function ProfileScreen() {
  const { user, profile, logout } = useAuthStore();
  const { t } = useLang();
  const { theme } = useTheme();

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [employeeId, setEmployeeId] = useState(profile?.employeeId ?? '');
  const [depot, setDepot] = useState(profile?.depot ?? '');
  const [saving, setSaving] = useState(false);

  const initials = getInitials(profile?.firstName, profile?.lastName);

  async function handleSaveProfile() {
    const token = await tokenStorage.get();
    if (token === 'demo_mode_token') {
      Alert.alert(t.profile_demoMode, t.profile_demoModeMsg);
      return;
    }
    const dto: UpdateProfileDto = { firstName, lastName, employeeId, depot };
    const result = UpdateProfileDtoSchema.safeParse(dto);
    if (!result.success) {
      Alert.alert(t.common_error, t.profile_profileError);
      return;
    }
    setSaving(true);
    try {
      await http.patch('/users/me/profile', result.data);
      Alert.alert(t.common_done, t.profile_profileSaved);
    } catch {
      Alert.alert(t.common_error, t.profile_profileError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg, padding: 16 }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <Text style={[s.header, { color: theme.text }]}>{t.profile_title}</Text>

      {/* Avatar */}
      <View style={s.avatarWrap}>
        <View style={[s.avatar, { backgroundColor: theme.primaryDark, borderColor: theme.primary }]}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        {(profile?.firstName || profile?.lastName) && (
          <Text style={[s.avatarName, { color: theme.text }]}>
            {[profile.firstName, profile.lastName].filter(Boolean).join(' ')}
          </Text>
        )}
      </View>

      {/* User info */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.email, { color: theme.text }]}>{user?.email}</Text>
        <Text style={[s.role, { color: theme.textDim }]}>
          {user?.role === 'DRIVER' ? t.profile_driver : t.profile_assistant}
        </Text>
      </View>

      {/* Profile fields */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Field label={t.profile_firstName} value={firstName} onChange={setFirstName} theme={theme} />
        <Field label={t.profile_lastName} value={lastName} onChange={setLastName} theme={theme} />
        <Field label={t.profile_employeeId} value={employeeId} onChange={setEmployeeId} theme={theme} />
        <Field label={t.profile_depot} value={depot} onChange={setDepot} theme={theme} />
        <TouchableOpacity
          style={[s.btn, { backgroundColor: theme.primary }]}
          onPress={handleSaveProfile}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{t.profile_saveProfile}</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={s.logoutBtn}
        onPress={async () => {
          await logout();
          router.replace('/(auth)/login');
        }}
      >
        <Text style={[s.logoutText, { color: theme.danger }]}>{t.profile_logout}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label, value, onChange, keyboardType = 'default', placeholder, theme,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'default' | 'numeric';
  placeholder?: string;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[s.label, { color: theme.textDim }]}>{label}</Text>
      <TextInput
        style={[s.input, {
          backgroundColor: theme.surface, color: theme.text, borderColor: theme.border,
        }]}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={theme.textMute}
      />
    </View>
  );
}

const s = StyleSheet.create({
  header: { fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 20 },

  avatarWrap: { alignItems: 'center', marginBottom: 20 },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  avatarName: { fontSize: 18, fontWeight: '600' },

  card: { borderRadius: 14, padding: 16, marginBottom: 12 },
  email: { fontSize: 16, fontWeight: '600' },
  role: { fontSize: 14, marginTop: 4 },
  label: { fontSize: 13, marginBottom: 4 },
  input: { borderRadius: 10, padding: 12, fontSize: 15, borderWidth: 1 },
  btn: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  logoutBtn: { padding: 16, alignItems: 'center' },
  logoutText: { fontSize: 15, fontWeight: '600' },
});
