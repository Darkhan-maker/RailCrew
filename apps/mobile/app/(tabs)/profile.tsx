import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { useTripsStore } from '@/store/trips.store';
import { http } from '@/services/api.service';
import { backupStorage, tokenStorage } from '@/services/storage.service';
import { UpdateProfileDtoSchema, UpdateProfileDto } from '@railcrew/contracts';
import { useLang, pluralTrips } from '@/i18n';

const C = {
  bg: '#0B0F14',
  surface: '#111820',
  card: '#192030',
  line: '#263245',
  text: '#E8EEF5',
  textDim: '#8A99AD',
  textMute: '#5B6A7E',
  blue: '#2472CC',
  blueDark: '#1A5BA8',
  danger: '#FF5A5F',
};

function getInitials(first?: string | null, last?: string | null): string {
  const f = first?.trim()[0]?.toUpperCase() ?? '';
  const l = last?.trim()[0]?.toUpperCase() ?? '';
  return (f + l) || '?';
}

export default function ProfileScreen() {
  const { user, profile, logout } = useAuthStore();
  const { loadLocal } = useTripsStore();
  const { t } = useLang();

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [employeeId, setEmployeeId] = useState(profile?.employeeId ?? '');
  const [depot, setDepot] = useState(profile?.depot ?? '');
  const [saving, setSaving] = useState(false);

  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

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

  async function handleExportBackup() {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert(t.profile_backupUnavailableTitle, t.profile_backupUnavailable);
      return;
    }
    setBackupBusy(true);
    try {
      const json = await backupStorage.export();
      const fileName = `backup_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`;
      const fileUri = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: t.profile_backup,
      });
    } catch {
      Alert.alert(t.common_error, t.profile_backupError);
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImportBackup() {
    Alert.alert(
      t.profile_restoreTitle,
      t.profile_restoreMsg,
      [
        { text: t.common_cancel, style: 'cancel' },
        {
          text: t.profile_restore,
          style: 'destructive',
          onPress: async () => {
            setRestoreBusy(true);
            try {
              const result = await DocumentPicker.getDocumentAsync({
                type: 'application/json',
                copyToCacheDirectory: true,
              });
              if (result.canceled || !result.assets?.[0]) return;

              const uri = result.assets[0].uri;
              const json = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.UTF8,
              });

              const { trips, routes } = await backupStorage.import(json);
              await loadLocal();
              Alert.alert(
                t.common_done,
                `${t.profile_restoredPrefix}${trips} ${pluralTrips(trips, t)}, ${routes}${t.profile_restoredSuffix}`,
              );
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : t.profile_restoreError;
              Alert.alert(t.common_error, msg);
            } finally {
              setRestoreBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={s.header}>{t.profile_title}</Text>

      {/* Avatar */}
      <View style={s.avatarWrap}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        {(profile?.firstName || profile?.lastName) && (
          <Text style={s.avatarName}>
            {[profile.firstName, profile.lastName].filter(Boolean).join(' ')}
          </Text>
        )}
      </View>

      {/* User info */}
      <View style={s.card}>
        <Text style={s.email}>{user?.email}</Text>
        <Text style={s.role}>
          {user?.role === 'DRIVER' ? t.profile_driver : t.profile_assistant}
        </Text>
      </View>

      {/* Profile fields */}
      <View style={s.card}>
        <Field label={t.profile_firstName} value={firstName} onChange={setFirstName} />
        <Field label={t.profile_lastName} value={lastName} onChange={setLastName} />
        <Field label={t.profile_employeeId} value={employeeId} onChange={setEmployeeId} />
        <Field label={t.profile_depot} value={depot} onChange={setDepot} />
        <TouchableOpacity style={s.btn} onPress={handleSaveProfile} disabled={saving}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{t.profile_saveProfile}</Text>}
        </TouchableOpacity>
      </View>

      {/* Backup */}
      <View style={s.card}>
        <Text style={s.cardTitle}>{t.profile_backup}</Text>
        <Text style={s.cardHint}>{t.profile_backupHint}</Text>

        <TouchableOpacity
          style={s.btn}
          onPress={handleExportBackup}
          disabled={backupBusy}
        >
          {backupBusy
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{t.profile_createBackup}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btn, s.btnOutline, { marginTop: 8 }]}
          onPress={handleImportBackup}
          disabled={restoreBusy}
        >
          {restoreBusy
            ? <ActivityIndicator color={C.blue} />
            : <Text style={s.btnOutlineText}>{t.profile_restoreBackup}</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={s.logoutBtn}
        onPress={async () => {
          await logout();
          router.replace('/(auth)/login');
        }}
      >
        <Text style={s.logoutText}>{t.profile_logout}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label, value, onChange, keyboardType = 'default', placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'default' | 'numeric';
  placeholder?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={C.textMute}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, padding: 16 },
  header: {
    color: C.text, fontSize: 24, fontWeight: 'bold',
    marginTop: 48, marginBottom: 20,
  },

  avatarWrap: { alignItems: 'center', marginBottom: 20 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.blueDark,
    borderWidth: 2, borderColor: C.blue,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  avatarName: { color: C.text, fontSize: 18, fontWeight: '600' },

  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardHint: { color: C.textMute, fontSize: 13, marginBottom: 12 },
  email: { color: C.text, fontSize: 16, fontWeight: '600' },
  role: { color: C.textDim, fontSize: 14, marginTop: 4 },
  label: { color: C.textDim, fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: C.surface, color: C.text, borderRadius: 10,
    padding: 12, fontSize: 15, borderWidth: 1, borderColor: C.line,
  },
  btn: {
    backgroundColor: C.blue, borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnOutline: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: C.blue,
  },
  btnOutlineText: { color: C.blue, fontSize: 15, fontWeight: '600' },
  logoutBtn: { padding: 16, alignItems: 'center' },
  logoutText: { color: C.danger, fontSize: 15, fontWeight: '600' },
});
