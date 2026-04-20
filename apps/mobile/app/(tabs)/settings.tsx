import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Switch, ActivityIndicator,
} from 'react-native';
import {
  localSettingsStorage, LocalSettings,
  localSalaryStorage, LocalSalaryRule,
} from '@/services/storage.service';
import { useAuthStore } from '@/store/auth.store';

// ─── Часовые пояса (относительно Москвы) ─────────────────────────────────────

const TIMEZONE_OPTIONS: { label: string; value: number }[] = [
  { label: 'Калининград (МСК−1)', value: -1 },
  { label: 'Москва (МСК)', value: 0 },
  { label: 'Самара (МСК+1)', value: 1 },
  { label: 'Екатеринбург (МСК+2)', value: 2 },
  { label: 'Казахстан Запад (МСК+2)', value: 2 },
  { label: 'Казахстан Восток (МСК+3)', value: 3 },
  { label: 'Омск (МСК+3)', value: 3 },
  { label: 'Красноярск (МСК+4)', value: 4 },
  { label: 'Иркутск (МСК+5)', value: 5 },
  { label: 'Якутск (МСК+6)', value: 6 },
  { label: 'Владивосток (МСК+7)', value: 7 },
  { label: 'Магадан (МСК+8)', value: 8 },
  { label: 'Камчатка (МСК+9)', value: 9 },
];

export default function SettingsScreen() {
  const { profile, user } = useAuthStore();
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [salary, setSalary] = useState<LocalSalaryRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);

  useEffect(() => {
    localSettingsStorage.get().then(setSettings);
    localSalaryStorage.get().then(setSalary);
  }, []);

  if (!settings || !salary) {
    return (
      <View style={s.screen}>
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 100 }} />
      </View>
    );
  }

  function updateSetting<K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) {
    setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  function updateSalary<K extends keyof LocalSalaryRule>(key: K, value: LocalSalaryRule[K]) {
    setSalary((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  async function handleSave() {
    if (!settings || !salary) return;

    // Валидация
    if (salary.ratePerHour < 0) {
      Alert.alert('Ошибка', 'Ставка за час не может быть отрицательной');
      return;
    }
    if (settings.monthlyHoursNorm <= 0 || settings.monthlyHoursNorm > 300) {
      Alert.alert('Ошибка', 'Норма часов должна быть от 1 до 300');
      return;
    }
    if (settings.nightStartHour < 0 || settings.nightStartHour > 23 ||
        settings.nightEndHour < 0 || settings.nightEndHour > 23) {
      Alert.alert('Ошибка', 'Часы ночного времени: от 0 до 23');
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        localSettingsStorage.save(settings),
        localSalaryStorage.save(salary),
      ]);
      Alert.alert('Готово', 'Настройки сохранены');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  }

  const currentTz = TIMEZONE_OPTIONS.find((t) => t.value === settings.timezoneOffsetFromMoscow);

  const initials = profile
    ? ((profile.firstName?.[0] ?? '') + (profile.lastName?.[0] ?? '')).toUpperCase() || '?'
    : '?';

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.header}>Настройки</Text>

      {/* ─── Профиль ──────────────────────────────────────────────────────── */}
      {profile && (
        <View style={[s.card, s.profileCard]}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>
              {[profile.firstName, profile.lastName].filter(Boolean).join(' ')}
            </Text>
            {user?.email ? <Text style={s.profileEmail}>{user.email}</Text> : null}
          </View>
        </View>
      )}

      {/* ─── Часовой пояс ─────────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Часовой пояс</Text>
        <Text style={s.cardHint}>
          Разница с московским временем для корректного расчёта переходных поездок
        </Text>

        <TouchableOpacity
          style={s.selectField}
          onPress={() => setTzPickerOpen(!tzPickerOpen)}
          activeOpacity={0.7}
        >
          <Text style={s.selectValue}>
            {currentTz?.label ?? `МСК${settings.timezoneOffsetFromMoscow >= 0 ? '+' : ''}${settings.timezoneOffsetFromMoscow}`}
          </Text>
          <Text style={s.selectArrow}>{tzPickerOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {tzPickerOpen && (
          <View style={s.optionsList}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <TouchableOpacity
                key={tz.value + tz.label}
                style={[
                  s.optionItem,
                  tz.value === settings.timezoneOffsetFromMoscow && s.optionItemActive,
                ]}
                onPress={() => {
                  updateSetting('timezoneOffsetFromMoscow', tz.value);
                  setTzPickerOpen(false);
                }}
              >
                <Text style={[
                  s.optionText,
                  tz.value === settings.timezoneOffsetFromMoscow && s.optionTextActive,
                ]}>
                  {tz.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* ─── Норма часов ──────────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Норма часов</Text>
        <Text style={s.cardHint}>Месячная норма рабочих часов по графику</Text>
        <NumericField
          label="Часов в месяц"
          value={settings.monthlyHoursNorm}
          onChange={(v) => updateSetting('monthlyHoursNorm', v)}
          placeholder="176"
        />
      </View>

      {/* ─── Локомотив по умолчанию ───────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Локомотив по умолчанию</Text>
        <Text style={s.cardHint}>
          Будет подставляться при добавлении новой поездки
        </Text>
        <View style={{ marginBottom: 10 }}>
          <Text style={s.label}>Модель (серия)</Text>
          <TextInput
            style={s.input}
            value={settings.defaultLocoModel}
            onChangeText={(v) => updateSetting('defaultLocoModel', v)}
            placeholder="Например: ВЛ80, КЗ8А, ТЭ33А"
            placeholderTextColor="#475569"
          />
        </View>
        <View>
          <Text style={s.label}>Номер</Text>
          <TextInput
            style={s.input}
            value={settings.defaultLocoNumber}
            onChangeText={(v) => updateSetting('defaultLocoNumber', v)}
            placeholder="Например: 0542"
            placeholderTextColor="#475569"
          />
        </View>
      </View>

      {/* ─── Ночные часы ──────────────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Учёт ночных часов</Text>
            <Text style={s.cardHint}>Автоматический подсчёт часов в ночное время</Text>
          </View>
          <Switch
            value={settings.trackNightHours}
            onValueChange={(v) => updateSetting('trackNightHours', v)}
            trackColor={{ false: '#334155', true: '#1d4ed8' }}
            thumbColor={settings.trackNightHours ? '#3b82f6' : '#64748b'}
          />
        </View>

        {settings.trackNightHours && (
          <View style={s.nightHoursRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>С (час)</Text>
              <TextInput
                style={s.input}
                value={String(settings.nightStartHour)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 23) updateSetting('nightStartHour', n);
                }}
                keyboardType="numeric"
                placeholder="22"
                placeholderTextColor="#475569"
              />
            </View>
            <Text style={s.nightDash}>—</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>До (час)</Text>
              <TextInput
                style={s.input}
                value={String(settings.nightEndHour)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 23) updateSetting('nightEndHour', n);
                }}
                keyboardType="numeric"
                placeholder="6"
                placeholderTextColor="#475569"
              />
            </View>
          </View>
        )}
      </View>

      {/* ─── Электроэнергия ───────────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Учёт электроэнергии</Text>
            <Text style={s.cardHint}>
              Показания счётчиков при приёмке и сдаче локомотива
            </Text>
          </View>
          <Switch
            value={settings.trackElectricity}
            onValueChange={(v) => updateSetting('trackElectricity', v)}
            trackColor={{ false: '#334155', true: '#1d4ed8' }}
            thumbColor={settings.trackElectricity ? '#3b82f6' : '#64748b'}
          />
        </View>
      </View>

      {/* ─── Следование пассажиром ────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Следование пассажиром</Text>
            <Text style={s.cardHint}>
              Дополнительные поля для учёта выезда/прибытия пассажиром
            </Text>
          </View>
          <Switch
            value={settings.trackPassengerTravel}
            onValueChange={(v) => updateSetting('trackPassengerTravel', v)}
            trackColor={{ false: '#334155', true: '#1d4ed8' }}
            thumbColor={settings.trackPassengerTravel ? '#3b82f6' : '#64748b'}
          />
        </View>
      </View>

      {/* ─── Расчёт зарплаты ──────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Расчёт зарплаты</Text>
        <Text style={s.cardHint}>
          Коэффициенты и ставки для ориентировочного подсчёта
        </Text>

        <NumericField
          label="Ставка за час (₸)"
          value={salary.ratePerHour}
          onChange={(v) => updateSalary('ratePerHour', v)}
          placeholder="2500"
        />
        <NumericField
          label="Бонус за поездку (₸)"
          value={salary.tripBonus}
          onChange={(v) => updateSalary('tripBonus', v)}
          placeholder="500"
        />
        <NumericField
          label="Ночной коэффициент"
          value={salary.nightCoefficient}
          onChange={(v) => updateSalary('nightCoefficient', v)}
          placeholder="1.4"
          decimal
        />
        <NumericField
          label="Коэффициент сверхурочных"
          value={salary.overtimeCoefficient}
          onChange={(v) => updateSalary('overtimeCoefficient', v)}
          placeholder="1.5"
          decimal
        />
        <NumericField
          label="Порог сверхурочных (ч/мес)"
          value={salary.monthlyHoursThreshold}
          onChange={(v) => updateSalary('monthlyHoursThreshold', v)}
          placeholder="176"
        />
      </View>

      {/* ─── Сохранить ────────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[s.saveBtn, saving && { opacity: 0.5 }]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.75}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.saveBtnText}>Сохранить все настройки</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Вспомогательные компоненты ──────────────────────────────────────────────

function NumericField({
  label, value, onChange, placeholder, decimal,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  decimal?: boolean;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : '');

  useEffect(() => {
    setText(value > 0 ? String(value) : '');
  }, [value]);

  function handleChange(v: string) {
    setText(v);
    const cleaned = v.replace(',', '.');
    const n = decimal ? parseFloat(cleaned) : parseInt(cleaned, 10);
    if (!isNaN(n) && n >= 0) onChange(n);
  }

  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={text}
        onChangeText={handleChange}
        keyboardType="numeric"
        placeholder={placeholder}
        placeholderTextColor="#475569"
      />
    </View>
  );
}

// ─── Стили ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  header: {
    color: '#f1f5f9', fontSize: 24, fontWeight: 'bold',
    marginTop: 48, marginBottom: 16,
  },

  card: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  cardHint: { color: '#475569', fontSize: 13, marginBottom: 12 },

  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#0f2847', borderWidth: 2, borderColor: '#4D8DFF',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { color: '#4D8DFF', fontSize: 20, fontWeight: '700' },
  profileName: { color: '#f1f5f9', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  profileEmail: { color: '#475569', fontSize: 13 },

  label: { color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: '#0f172a', color: '#f1f5f9', borderRadius: 10,
    padding: 12, fontSize: 15,
  },

  // Select / Dropdown
  selectField: {
    backgroundColor: '#0f172a', borderRadius: 10, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  selectValue: { color: '#f1f5f9', fontSize: 15, flex: 1 },
  selectArrow: { color: '#64748b', fontSize: 12, marginLeft: 8 },

  optionsList: {
    marginTop: 8, borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: '#334155',
  },
  optionItem: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  optionItemActive: { backgroundColor: '#1e3a5f' },
  optionText: { color: '#94a3b8', fontSize: 14 },
  optionTextActive: { color: '#3b82f6', fontWeight: '600' },

  // Switch row
  switchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },

  // Night hours
  nightHoursRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12,
  },
  nightDash: { color: '#64748b', fontSize: 18, paddingBottom: 12 },

  // Save
  saveBtn: {
    backgroundColor: '#3b82f6', borderRadius: 12, padding: 16,
    alignItems: 'center', marginTop: 4, marginBottom: 20,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
