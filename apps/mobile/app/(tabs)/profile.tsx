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

export default function ProfileScreen() {
  const { user, profile, logout } = useAuthStore();
  const { loadLocal } = useTripsStore();

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [employeeId, setEmployeeId] = useState(profile?.employeeId ?? '');
  const [depot, setDepot] = useState(profile?.depot ?? '');
  const [saving, setSaving] = useState(false);

  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  async function handleSaveProfile() {
    const token = await tokenStorage.get();
    if (token === 'demo_mode_token') {
      Alert.alert('Демо-режим', 'В демо-режиме сохранение профиля недоступно');
      return;
    }
    const dto: UpdateProfileDto = { firstName, lastName, employeeId, depot };
    const result = UpdateProfileDtoSchema.safeParse(dto);
    if (!result.success) {
      Alert.alert('Ошибка', 'Проверьте введённые данные');
      return;
    }
    setSaving(true);
    try {
      await http.patch('/users/me/profile', result.data);
      Alert.alert('Готово', 'Профиль обновлён');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить профиль');
    } finally {
      setSaving(false);
    }
  }

  async function handleExportBackup() {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert('Недоступно', 'Экспорт не поддерживается на этом устройстве');
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
        dialogTitle: 'Сохранить резервную копию',
      });
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать резервную копию');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImportBackup() {
    Alert.alert(
      'Восстановить из копии',
      'Текущие данные будут заменены. Продолжить?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Восстановить',
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
              Alert.alert('Готово', `Восстановлено: ${trips} поездок, ${routes} шаблонов`);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Не удалось восстановить данные';
              Alert.alert('Ошибка', msg);
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
      <Text style={s.header}>Профиль</Text>

      {/* Инфо пользователя */}
      <View style={s.card}>
        <Text style={s.email}>{user?.email}</Text>
        <Text style={s.role}>
          {user?.role === 'DRIVER' ? 'Машинист' : 'Помощник машиниста'}
        </Text>
      </View>

      {/* Данные профиля */}
      <View style={s.card}>
        <Field label="Имя" value={firstName} onChange={setFirstName} />
        <Field label="Фамилия" value={lastName} onChange={setLastName} />
        <Field label="Табельный номер" value={employeeId} onChange={setEmployeeId} />
        <Field label="Депо" value={depot} onChange={setDepot} />
        <TouchableOpacity style={s.btn} onPress={handleSaveProfile} disabled={saving}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Сохранить профиль</Text>}
        </TouchableOpacity>
      </View>

      {/* Резервная копия */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Резервная копия</Text>
        <Text style={s.cardHint}>
          Сохраняет все поездки, шаблоны маршрутов и настройки в JSON-файл
        </Text>

        <TouchableOpacity
          style={s.btn}
          onPress={handleExportBackup}
          disabled={backupBusy}
        >
          {backupBusy
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Создать резервную копию</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btn, s.btnOutline, { marginTop: 8 }]}
          onPress={handleImportBackup}
          disabled={restoreBusy}
        >
          {restoreBusy
            ? <ActivityIndicator color="#3b82f6" />
            : <Text style={s.btnOutlineText}>Восстановить из файла</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={s.logoutBtn}
        onPress={async () => {
          await logout();
          router.replace('/(auth)/login');
        }}
      >
        <Text style={s.logoutText}>Выйти</Text>
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
        placeholderTextColor="#475569"
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  header: {
    color: '#f1f5f9', fontSize: 24, fontWeight: 'bold',
    marginTop: 48, marginBottom: 16,
  },
  card: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardHint: { color: '#475569', fontSize: 13, marginBottom: 12 },
  email: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  role: { color: '#64748b', fontSize: 14, marginTop: 4 },
  label: { color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: '#0f172a', color: '#f1f5f9', borderRadius: 10,
    padding: 12, fontSize: 15,
  },
  btn: {
    backgroundColor: '#3b82f6', borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnOutline: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3b82f6',
  },
  btnOutlineText: { color: '#3b82f6', fontSize: 15, fontWeight: '600' },
  logoutBtn: { padding: 16, alignItems: 'center' },
  logoutText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
});
