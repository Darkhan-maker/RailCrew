import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Clipboard,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { useTripsStore } from '@/store/trips.store';
import { http, telegramApi } from '@/services/api.service';
import { backupStorage, tokenStorage } from '@/services/storage.service';
import { UpdateProfileDtoSchema, UpdateProfileDto } from '@railcrew/contracts';
import { useLang, pluralTrips } from '@/i18n';
import { useTheme } from '@/theme';
import { UserCircle } from 'lucide-react-native';

function getInitials(first?: string | null, last?: string | null): string {
  const f = first?.trim()[0]?.toUpperCase() ?? '';
  const l = last?.trim()[0]?.toUpperCase() ?? '';
  return (f + l) || '?';
}

export default function ProfileScreen() {
  const { user, profile, logout } = useAuthStore();
  const { loadLocal } = useTripsStore();
  const { t } = useLang();
  const { theme } = useTheme();

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [employeeId, setEmployeeId] = useState(profile?.employeeId ?? '');
  const [depot, setDepot] = useState(profile?.depot ?? '');
  const [saving, setSaving] = useState(false);

  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);

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

  async function handleGenerateTelegramCode() {
    const token = await tokenStorage.get();
    if (token === 'demo_mode_token') {
      Alert.alert(t.profile_demoMode, t.profile_demoModeMsg);
      return;
    }
    setTelegramBusy(true);
    try {
      const { code } = await telegramApi.generateCode();
      setTelegramCode(code);
      Clipboard.setString(code);
    } catch {
      Alert.alert(t.common_error, t.profile_telegramError);
    } finally {
      setTelegramBusy(false);
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
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg, padding: 16 }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 48, marginBottom: 20 }}>
        <UserCircle size={26} color={theme.primary} />
        <Text style={[s.header, { color: theme.text, marginTop: 0, marginBottom: 0 }]}>{t.profile_title}</Text>
      </View>

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

      {/* Telegram */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.profile_telegram}</Text>
        <Text style={[s.cardHint, { color: theme.textMute }]}>{t.profile_telegramHint}</Text>

        {telegramCode ? (
          <View style={[s.codeBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[s.codeLabel, { color: theme.textDim }]}>{t.profile_telegramCodeLabel}</Text>
            <Text style={[s.codeValue, { color: theme.primary }]}>{telegramCode}</Text>
            <Text style={[s.codeInstr, { color: theme.textMute }]}>{t.profile_telegramInstructions}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[s.btn, { backgroundColor: theme.primary }]}
          onPress={handleGenerateTelegramCode}
          disabled={telegramBusy}
        >
          {telegramBusy
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{t.profile_telegramGetCode}</Text>}
        </TouchableOpacity>
      </View>

      {/* Backup */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.profile_backup}</Text>
        <Text style={[s.cardHint, { color: theme.textMute }]}>{t.profile_backupHint}</Text>

        <TouchableOpacity
          style={[s.btn, { backgroundColor: theme.primary }]}
          onPress={handleExportBackup}
          disabled={backupBusy}
        >
          {backupBusy
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{t.profile_createBackup}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btn, s.btnOutline, { marginTop: 8, borderColor: theme.primary }]}
          onPress={handleImportBackup}
          disabled={restoreBusy}
        >
          {restoreBusy
            ? <ActivityIndicator color={theme.primary} />
            : <Text style={[s.btnOutlineText, { color: theme.primary }]}>{t.profile_restoreBackup}</Text>}
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
  header: {
    fontSize: 24, fontWeight: 'bold',
    marginTop: 48, marginBottom: 20,
  },

  avatarWrap: { alignItems: 'center', marginBottom: 20 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  avatarName: { fontSize: 18, fontWeight: '600' },

  card: {
    borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardHint: { fontSize: 13, marginBottom: 12 },
  email: { fontSize: 16, fontWeight: '600' },
  role: { fontSize: 14, marginTop: 4 },
  label: { fontSize: 13, marginBottom: 4 },
  input: {
    borderRadius: 10,
    padding: 12, fontSize: 15, borderWidth: 1,
  },
  btn: {
    borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnOutline: {
    backgroundColor: 'transparent', borderWidth: 1,
  },
  btnOutlineText: { fontSize: 15, fontWeight: '600' },
  logoutBtn: { padding: 16, alignItems: 'center' },
  logoutText: { fontSize: 15, fontWeight: '600' },
  codeBox: {
    borderRadius: 10, borderWidth: 1,
    padding: 14, marginBottom: 10, alignItems: 'center',
  },
  codeLabel: { fontSize: 12, marginBottom: 6 },
  codeValue: { fontSize: 32, fontWeight: '700', letterSpacing: 4, marginBottom: 6 },
  codeInstr: { fontSize: 12, textAlign: 'center' },
});
