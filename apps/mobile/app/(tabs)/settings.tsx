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
import { useLang, Lang } from '@/i18n';
import { useTheme, ThemeKey, THEMES } from '@/theme';
import { Settings as SettingsIcon, Palette, Calculator, Send, Cloud, Info, User } from 'lucide-react-native';

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

const THEME_SWATCHES: { key: ThemeKey; color: string }[] = [
  { key: 'blue',   color: '#2472CC' },
  { key: 'green',  color: '#10B981' },
  { key: 'purple', color: '#8B5CF6' },
  { key: 'orange', color: '#F59E0B' },
];

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  const { theme } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginBottom: 8, marginTop: 8, paddingHorizontal: 4,
    }}>
      <View style={{
        width: 32, height: 32, borderRadius: 8,
        backgroundColor: theme.primaryDim,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </View>
      <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>{title}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { profile, user } = useAuthStore();
  const { t, lang, setLang } = useLang();
  const { theme, themeKey, setThemeKey } = useTheme();
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
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.primary} style={{ marginTop: 100 }} />
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

    if (salary.ratePerHour < 0) {
      Alert.alert(t.common_error, t.settings_errRate);
      return;
    }
    if (settings.monthlyHoursNorm <= 0 || settings.monthlyHoursNorm > 300) {
      Alert.alert(t.common_error, t.settings_errNorm);
      return;
    }
    if (settings.nightStartHour < 0 || settings.nightStartHour > 23 ||
        settings.nightEndHour < 0 || settings.nightEndHour > 23) {
      Alert.alert(t.common_error, t.settings_errNight);
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        localSettingsStorage.save(settings),
        localSalaryStorage.save(salary),
      ]);
      Alert.alert(t.common_done, t.settings_saved);
    } catch {
      Alert.alert(t.common_error, t.settings_saveError);
    } finally {
      setSaving(false);
    }
  }

  const currentTz = TIMEZONE_OPTIONS.find((tz) => tz.value === settings.timezoneOffsetFromMoscow);

  const initials = profile
    ? ((profile.firstName?.[0] ?? '') + (profile.lastName?.[0] ?? '')).toUpperCase() || '?'
    : '?';

  function themeLabel(key: ThemeKey): string {
    if (key === 'blue')   return t.settings_themeBlue;
    if (key === 'green')  return t.settings_themeGreen;
    if (key === 'purple') return t.settings_themePurple;
    return t.settings_themeOrange;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg, padding: 16 }}
      contentContainerStyle={{ paddingBottom: 60 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 48, marginBottom: 16 }}>
        <SettingsIcon size={26} color={theme.primary} />
        <Text style={[s.header, { color: theme.text, marginTop: 0, marginBottom: 0 }]}>{t.settings_title}</Text>
      </View>

      {/* ─── Профиль ──────────────────────────────────────────────────────── */}
      {profile && (
        <View style={[s.card, s.profileCard, { backgroundColor: theme.card }]}>
          <View style={[s.avatar, { backgroundColor: theme.primaryDark, borderColor: theme.primary }]}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.profileName, { color: theme.text }]}>
              {[profile.firstName, profile.lastName].filter(Boolean).join(' ')}
            </Text>
            {user?.email ? <Text style={[s.profileEmail, { color: theme.textMute }]}>{user.email}</Text> : null}
          </View>
        </View>
      )}

      {/* ─── Внешний вид ───────────────────────────────────────────────────── */}
      <SectionHeader icon={<Palette size={18} color={theme.primary} />} title={t.settings_theme} />
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_theme}</Text>
        <View style={s.swatchRow}>
          {THEME_SWATCHES.map((sw) => (
            <TouchableOpacity
              key={sw.key}
              onPress={() => setThemeKey(sw.key)}
              activeOpacity={0.8}
              style={[
                s.swatch,
                { backgroundColor: sw.color },
                themeKey === sw.key && { borderWidth: 3, borderColor: '#fff' },
              ]}
            />
          ))}
          <Text style={[s.swatchLabel, { color: theme.textDim }]}>
            {themeLabel(themeKey)}
          </Text>
        </View>
      </View>

      {/* ─── Язык / Тіл ───────────────────────────────────────────────────── */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_lang}</Text>
        <View style={s.langRow}>
          {(['ru', 'kk'] as Lang[]).map((l) => (
            <TouchableOpacity
              key={l}
              style={[
                s.langBtn,
                { backgroundColor: theme.surface, borderColor: theme.border },
                lang === l && { backgroundColor: theme.primary, borderColor: theme.primary },
              ]}
              onPress={() => setLang(l)}
              activeOpacity={0.75}
            >
              <Text style={[
                s.langBtnText,
                { color: theme.textMute },
                lang === l && { color: '#fff', fontWeight: '700' },
              ]}>
                {l === 'ru' ? t.settings_langRu : t.settings_langKk}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ─── Часовой пояс ─────────────────────────────────────────────────── */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_timezone}</Text>
        <Text style={[s.cardHint, { color: theme.textMute }]}>{t.settings_timezoneHint}</Text>

        <TouchableOpacity
          style={[s.selectField, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => setTzPickerOpen(!tzPickerOpen)}
          activeOpacity={0.7}
        >
          <Text style={[s.selectValue, { color: theme.text }]}>
            {currentTz?.label ?? `МСК${settings.timezoneOffsetFromMoscow >= 0 ? '+' : ''}${settings.timezoneOffsetFromMoscow}`}
          </Text>
          <Text style={[s.selectArrow, { color: theme.textMute }]}>{tzPickerOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {tzPickerOpen && (
          <View style={[s.optionsList, { borderColor: theme.border }]}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <TouchableOpacity
                key={tz.value + tz.label}
                style={[
                  s.optionItem,
                  { backgroundColor: theme.surface, borderBottomColor: theme.card },
                  tz.value === settings.timezoneOffsetFromMoscow && { backgroundColor: theme.primaryDark },
                ]}
                onPress={() => {
                  updateSetting('timezoneOffsetFromMoscow', tz.value);
                  setTzPickerOpen(false);
                }}
              >
                <Text style={[
                  s.optionText,
                  { color: theme.textDim },
                  tz.value === settings.timezoneOffsetFromMoscow && { color: '#fff', fontWeight: '600' },
                ]}>
                  {tz.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* ─── Норма часов ──────────────────────────────────────────────────── */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_hoursNorm}</Text>
        <Text style={[s.cardHint, { color: theme.textMute }]}>{t.settings_hoursNormHint}</Text>
        <NumericField
          label={t.settings_hoursPerMonth}
          value={settings.monthlyHoursNorm}
          onChange={(v) => updateSetting('monthlyHoursNorm', v)}
          placeholder="176"
          theme={theme}
        />
      </View>

      {/* ─── Локомотив по умолчанию ───────────────────────────────────────── */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_defaultLoco}</Text>
        <Text style={[s.cardHint, { color: theme.textMute }]}>{t.settings_defaultLocoHint}</Text>
        <View style={{ marginBottom: 10 }}>
          <Text style={[s.label, { color: theme.textDim }]}>{t.settings_locoModel}</Text>
          <TextInput
            style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            value={settings.defaultLocoModel}
            onChangeText={(v) => updateSetting('defaultLocoModel', v)}
            placeholder={t.settings_locoModelEx}
            placeholderTextColor={theme.textMute}
          />
        </View>
        <View>
          <Text style={[s.label, { color: theme.textDim }]}>{t.settings_locoNumber}</Text>
          <TextInput
            style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            value={settings.defaultLocoNumber}
            onChangeText={(v) => updateSetting('defaultLocoNumber', v)}
            placeholder={t.settings_locoNumberEx}
            placeholderTextColor={theme.textMute}
          />
        </View>
      </View>

      {/* ─── Ночные часы ──────────────────────────────────────────────────── */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_nightHours}</Text>
            <Text style={[s.cardHint, { color: theme.textMute }]}>{t.settings_nightHoursHint}</Text>
          </View>
          <Switch
            value={settings.trackNightHours}
            onValueChange={(v) => updateSetting('trackNightHours', v)}
            trackColor={{ false: theme.border, true: theme.primaryDark }}
            thumbColor={settings.trackNightHours ? theme.primary : theme.textMute}
          />
        </View>

        {settings.trackNightHours && (
          <View style={s.nightHoursRow}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { color: theme.textDim }]}>{t.settings_nightFrom}</Text>
              <TextInput
                style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                value={String(settings.nightStartHour)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 23) updateSetting('nightStartHour', n);
                }}
                keyboardType="numeric"
                placeholder="22"
                placeholderTextColor={theme.textMute}
              />
            </View>
            <Text style={[s.nightDash, { color: theme.textMute }]}>—</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { color: theme.textDim }]}>{t.settings_nightTo}</Text>
              <TextInput
                style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                value={String(settings.nightEndHour)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 23) updateSetting('nightEndHour', n);
                }}
                keyboardType="numeric"
                placeholder="6"
                placeholderTextColor={theme.textMute}
              />
            </View>
          </View>
        )}
      </View>

      {/* ─── Электроэнергия ───────────────────────────────────────────────── */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_electricity}</Text>
            <Text style={[s.cardHint, { color: theme.textMute }]}>{t.settings_electricityHint}</Text>
          </View>
          <Switch
            value={settings.trackElectricity}
            onValueChange={(v) => updateSetting('trackElectricity', v)}
            trackColor={{ false: theme.border, true: theme.primaryDark }}
            thumbColor={settings.trackElectricity ? theme.primary : theme.textMute}
          />
        </View>
      </View>

      {/* ─── Следование пассажиром ────────────────────────────────────────── */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_passengerTravel}</Text>
            <Text style={[s.cardHint, { color: theme.textMute }]}>{t.settings_passengerTravelHint}</Text>
          </View>
          <Switch
            value={settings.trackPassengerTravel}
            onValueChange={(v) => updateSetting('trackPassengerTravel', v)}
            trackColor={{ false: theme.border, true: theme.primaryDark }}
            thumbColor={settings.trackPassengerTravel ? theme.primary : theme.textMute}
          />
        </View>
      </View>

      {/* ─── Расчёт зарплаты ──────────────────────────────────────────────── */}
      <SectionHeader icon={<Calculator size={18} color={theme.primary} />} title={t.settings_salary} />
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>{t.settings_salary}</Text>
        <Text style={[s.cardHint, { color: theme.textMute }]}>{t.settings_salaryHint}</Text>

        <NumericField label={t.settings_ratePerHour} value={salary.ratePerHour}
          onChange={(v) => updateSalary('ratePerHour', v)} placeholder="2500" theme={theme} />
        <NumericField label={t.settings_tripBonus} value={salary.tripBonus}
          onChange={(v) => updateSalary('tripBonus', v)} placeholder="500" theme={theme} />
        <NumericField label={t.settings_tripBonusPerHour} value={salary.tripBonusPerHour}
          onChange={(v) => updateSalary('tripBonusPerHour', v)} placeholder="0" theme={theme} />
        <NumericField label={t.settings_nightCoeff} value={salary.nightCoefficient}
          onChange={(v) => updateSalary('nightCoefficient', v)} placeholder="1.4" decimal theme={theme} />
        <NumericField label={t.settings_holidayCoeff} value={salary.holidayCoefficient}
          onChange={(v) => updateSalary('holidayCoefficient', v)} placeholder="2" decimal theme={theme} />
        <NumericField label={t.settings_overtimeCoeff} value={salary.overtimeCoefficient}
          onChange={(v) => updateSalary('overtimeCoefficient', v)} placeholder="1.5" decimal theme={theme} />
        <NumericField label={t.settings_overtimeThreshold} value={salary.monthlyHoursThreshold}
          onChange={(v) => updateSalary('monthlyHoursThreshold', v)} placeholder="176" theme={theme} />
        <NumericField label={t.settings_harmfulness} value={salary.harmfulnessPercent}
          onChange={(v) => updateSalary('harmfulnessPercent', v)} placeholder="0" decimal theme={theme} />
        <NumericField label={t.settings_classBonus} value={salary.classPercent}
          onChange={(v) => updateSalary('classPercent', v)} placeholder="0" decimal theme={theme} />
        <NumericField label={t.settings_zonalBonus} value={salary.zonalPercent}
          onChange={(v) => updateSalary('zonalPercent', v)} placeholder="0" decimal theme={theme} />
        <NumericField label={t.settings_regionalCoeff} value={salary.regionalCoefficient}
          onChange={(v) => updateSalary('regionalCoefficient', v)} placeholder="1" decimal theme={theme} />
        <NumericField label={t.settings_union} value={salary.unionPercent}
          onChange={(v) => updateSalary('unionPercent', v)} placeholder="1" decimal theme={theme} />
        <NumericField label={t.settings_tax} value={salary.taxPercent}
          onChange={(v) => updateSalary('taxPercent', v)} placeholder="13" decimal theme={theme} />
      </View>

      {/* ─── Сохранить ────────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[s.saveBtn, { backgroundColor: theme.primary }, saving && { opacity: 0.5 }]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.75}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.saveBtnText}>{t.settings_saveAll}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function NumericField({
  label, value, onChange, placeholder, decimal, theme,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  decimal?: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
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
      <Text style={[s.label, { color: theme.textDim }]}>{label}</Text>
      <TextInput
        style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
        value={text}
        onChangeText={handleChange}
        keyboardType="numeric"
        placeholder={placeholder}
        placeholderTextColor={theme.textMute}
      />
    </View>
  );
}

const s = StyleSheet.create({
  header: { fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 16 },
  card: {
    borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  cardHint: { fontSize: 13, marginBottom: 12 },

  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  profileEmail: { fontSize: 13 },

  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  swatchLabel: { fontSize: 14, marginLeft: 4 },

  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
    alignItems: 'center',
  },
  langBtnText: { fontSize: 14, fontWeight: '500' },

  label: { fontSize: 13, marginBottom: 4 },
  input: {
    borderRadius: 10, padding: 12, fontSize: 15, borderWidth: 1,
  },

  selectField: {
    borderRadius: 10, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1,
  },
  selectValue: { fontSize: 15, flex: 1 },
  selectArrow: { fontSize: 12, marginLeft: 8 },

  optionsList: { marginTop: 8, borderRadius: 10, overflow: 'hidden', borderWidth: 1 },
  optionItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  optionText: { fontSize: 14 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nightHoursRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12 },
  nightDash: { fontSize: 18, paddingBottom: 12 },

  saveBtn: { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 4, marginBottom: 20 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
