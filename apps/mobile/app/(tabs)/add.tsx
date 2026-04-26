import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Platform, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useTripsStore } from '@/store/trips.store';
import {
  localRoutesStorage, LocalRoute,
  localSettingsStorage, LocalSettings,
  LocalCreateTripDto,
} from '@/services/storage.service';
import { CreateTripDto, TripType, TripTypeLabelMap, CreateTripDtoSchema, AppearanceType, AppearanceTypeLabelMap } from '@railcrew/contracts';
import { todayISO } from '@/utils/date';

const TYPES: TripType[] = ['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN'];

const C = {
  bg: '#0B0F14',
  surface: '#111820',
  card: '#192030',
  line: '#263245',
  lineSoft: '#1C2736',
  text: '#E8EEF5',
  textDim: '#8A99AD',
  textMute: '#5B6A7E',
  blue: '#2472CC',
  blueDark: '#1A5BA8',
  blueDim: '#0D3D7A',
  amber: '#F5B301',
  green: '#3BD48A',
  danger: '#FF5A5F',
};

// ─── Text parser ──────────────────────────────────────────────────────────────

const RU_MONTHS: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

function parseTextLocally(text: string): Partial<CreateTripDto> {
  const result: Partial<CreateTripDto> = {};
  const routeMatch = text.match(/([А-ЯЁA-Z][а-яёa-z\-]+)\s*[-–—]\s*([А-ЯЁA-Z][а-яёa-z\-]+)/);
  if (routeMatch) { result.routeFrom = routeMatch[1]; result.routeTo = routeMatch[2]; }
  const ruDate = text.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i);
  if (ruDate) {
    const day = parseInt(ruDate[1], 10);
    const month = RU_MONTHS[ruDate[2].toLowerCase()];
    result.date = format(new Date(new Date().getFullYear(), month, day), 'yyyy-MM-dd');
  } else {
    const isoDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoDate) result.date = isoDate[1];
  }
  const startMatch = text.match(/(?:явка|начало|старт|с|от)\s+(\d{1,2}:\d{2})/i);
  if (startMatch) result.startTime = startMatch[1].padStart(5, '0');
  const endMatch = text.match(/(?:сдача|окончание|конец|до|по)\s+(\d{1,2}:\d{2})/i);
  if (endMatch) result.endTime = endMatch[1].padStart(5, '0');
  if (/грузов/i.test(text)) result.tripType = 'FREIGHT';
  else if (/пассажир/i.test(text)) result.tripType = 'PASSENGER';
  else if (/маневр/i.test(text)) result.tripType = 'SHUNTING';
  else if (/резерв/i.test(text)) result.tripType = 'DEAD_RUN';
  return result;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function calcDurationFull(startDate: string, startTime: string, endDate: string, endTime: string): number | null {
  const start = new Date(`${startDate}T${startTime}:00`);
  const end = new Date(`${endDate}T${endTime}:00`);
  const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
  return diffMin > 0 ? diffMin : null;
}

function formatDurMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}


function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function parseTimeStr(timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0); return d;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PickerMode =
  | 'appearanceDate' | 'appearanceTime'
  | 'handoverDate' | 'handoverTime'
  | null;

type SectionMeterStr = { start: string; end: string };

type SectionRecuperationStr = { accepted: string; delivered: string };

type ExtendedFields = {
  trainNumber: string;
  trainWeight: string;
  axleCount: string;
  locoModel: string;
  locoNumber: string;
  lunchBreakMinutes: string;
  checkpointOut: string;
  checkpointIn: string;
  passengerDepartureTime: string;
  passengerArrivalTime: string;
};

function buildNotes(userNotes: string, ext: ExtendedFields): string {
  const parts: string[] = [];
  if (ext.passengerDepartureTime || ext.passengerArrivalTime) {
    parts.push(`Пассажиром: выезд ${ext.passengerDepartureTime || '—'}, прибытие ${ext.passengerArrivalTime || '—'}`);
  }
  if (userNotes.trim()) parts.push(userNotes.trim());
  return parts.join('\n');
}

function isNumericStr(s: string): boolean {
  return s === '' || /^\d+(\.\d+)?$/.test(s.trim());
}

function validateSectionMeters(meters: SectionMeterStr[]): string | null {
  for (let i = 0; i < meters.length; i++) {
    const { start, end } = meters[i];
    if (!isNumericStr(start)) return `Секция ${i + 1}: показание начало — не число`;
    if (!isNumericStr(end)) return `Секция ${i + 1}: показание конец — не число`;
    if (start && end && parseFloat(end) < parseFloat(start)) {
      return `Секция ${i + 1}: показание на конец меньше начального`;
    }
  }
  return null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AddTripScreen() {
  const params = useLocalSearchParams<{
    routeFrom?: string; routeTo?: string; tripType?: TripType; notes?: string;
    trainNumber?: string; trainWeight?: string; axleCount?: string;
    locoModel?: string; locoNumber?: string; sectionCount?: string;
  }>();

  const today = todayISO();

  // Core trip fields (sent to API via Zod schema)
  const [fields, setFields] = useState<Partial<CreateTripDto>>({
    status: 'CONFIRMED',
    ...(params.routeFrom ? { routeFrom: params.routeFrom } : {}),
    ...(params.routeTo ? { routeTo: params.routeTo } : {}),
    ...(params.tripType ? { tripType: params.tripType } : {}),
  });

  // Mobile-only structured extras — pre-filled from duplicate params when present
  const [extended, setExtended] = useState<ExtendedFields>({
    trainNumber: params.trainNumber ?? '',
    trainWeight: params.trainWeight ?? '',
    axleCount: params.axleCount ?? '',
    locoModel: params.locoModel ?? '',
    locoNumber: params.locoNumber ?? '',
    lunchBreakMinutes: '',
    checkpointOut: '',
    checkpointIn: '',
    passengerDepartureTime: '',
    passengerArrivalTime: '',
  });

  // Work-cycle timestamps
  const [appearanceDate, setAppearanceDate] = useState(today);
  const [appearanceTime, setAppearanceTime] = useState('');
  const [handoverDate, setHandoverDate] = useState(today);
  const [handoverTime, setHandoverTime] = useState('');

  // Section count + per-section electricity meters — pre-filled from duplicate params
  const initSectionCount = ((): 1 | 2 | 3 => {
    const n = parseInt(params.sectionCount ?? '', 10);
    return (n === 2 || n === 3) ? n : 1;
  })();
  const [sectionCount, setSectionCount] = useState<1 | 2 | 3>(initSectionCount);
  const [sectionMeters, setSectionMeters] = useState<SectionMeterStr[]>(
    Array.from({ length: initSectionCount }, () => ({ start: '', end: '' })),
  );
  const [sectionRecuperation, setSectionRecuperation] = useState<SectionRecuperationStr[]>(
    Array.from({ length: initSectionCount }, () => ({ accepted: '', delivered: '' })),
  );

  const [userNotes, setUserNotes] = useState(params.notes ?? '');
  const [voiceText, setVoiceText] = useState('');
  const [voiceDraft, setVoiceDraft] = useState<Partial<CreateTripDto> | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [timeError, setTimeError] = useState('');
  const [routes, setRoutes] = useState<LocalRoute[]>([]);
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const { addTrip } = useTripsStore();

  useEffect(() => {
    localRoutesStorage.getAll().then(setRoutes);
    localSettingsStorage.get().then((s) => {
      setSettings(s);
      if (s.defaultLocoModel || s.defaultLocoNumber) {
        setExtended((prev) => ({
          ...prev,
          locoModel: prev.locoModel || s.defaultLocoModel,
          locoNumber: prev.locoNumber || s.defaultLocoNumber,
        }));
      }
    });
  }, []);

  // Validate appearance → handover ordering
  useEffect(() => {
    if (appearanceTime && handoverTime) {
      const dur = calcDurationFull(appearanceDate, appearanceTime, handoverDate, handoverTime);
      setTimeError(dur === null ? 'Сдача не может быть раньше явки' : '');
    } else {
      setTimeError('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceDate, appearanceTime, handoverDate, handoverTime]);

  function setF(key: keyof CreateTripDto, value: string | number | TripType | AppearanceType | undefined) {
    setFields((f) => ({ ...f, [key]: value }));
  }
  function setExt(key: keyof ExtendedFields, value: string) {
    setExtended((prev) => ({ ...prev, [key]: value }));
  }

  function handleSectionCountChange(count: 1 | 2 | 3) {
    setSectionCount(count);
    setSectionMeters((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? { start: '', end: '' }),
    );
    setSectionRecuperation((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? { accepted: '', delivered: '' }),
    );
  }

  function setSectionRecup(idx: number, field: 'accepted' | 'delivered', value: string) {
    setSectionRecuperation((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function setSectionMeter(idx: number, field: 'start' | 'end', value: string) {
    setSectionMeters((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function applyTemplate(route: LocalRoute) {
    setFields((f) => ({ ...f, routeFrom: route.routeFrom, routeTo: route.routeTo, tripType: route.tripType }));
  }

  async function handleSaveTemplate() {
    const { routeFrom, routeTo, tripType } = fields;
    if (!routeFrom?.trim() || !routeTo?.trim() || !tripType) {
      Alert.alert('Заполните маршрут', 'Укажите станции и тип поездки');
      return;
    }
    const saved = await localRoutesStorage.save({ routeFrom, routeTo, tripType });
    setRoutes((prev) => (prev.find((r) => r.id === saved.id) ? prev : [saved, ...prev]));
    Alert.alert('Готово', 'Шаблон сохранён');
  }

  async function handleRemoveTemplate(id: string) {
    await localRoutesStorage.remove(id);
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  }

  function handleVoiceParse() {
    if (!voiceText.trim()) return;
    setParsing(true);
    setVoiceDraft(null);
    try {
      setVoiceDraft(parseTextLocally(voiceText));
    } finally {
      setParsing(false);
    }
  }

  function applyDraft() {
    if (!voiceDraft) return;
    setFields((f) => ({ ...f, ...voiceDraft }));
    setVoiceDraft(null); setVoiceText('');
  }

  function handlePickerChange(_: DateTimePickerEvent, selected?: Date) {
    const mode = pickerMode;
    if (Platform.OS === 'android') setPickerMode(null);
    if (!selected || !mode) return;

    switch (mode) {
      case 'appearanceDate':
        setAppearanceDate(format(selected, 'yyyy-MM-dd'));
        break;
      case 'appearanceTime':
        setAppearanceTime(format(selected, 'HH:mm'));
        break;
      case 'handoverDate':
        setHandoverDate(format(selected, 'yyyy-MM-dd'));
        break;
      case 'handoverTime':
        setHandoverTime(format(selected, 'HH:mm'));
        break;
    }
  }

  function pickerValue(): Date {
    switch (pickerMode) {
      case 'appearanceDate': return parseDateStr(appearanceDate);
      case 'appearanceTime': return appearanceTime ? parseTimeStr(appearanceTime) : new Date();
      case 'handoverDate': return parseDateStr(handoverDate);
      case 'handoverTime': return handoverTime ? parseTimeStr(handoverTime) : new Date();
      default: return new Date();
    }
  }

  function pickerMinDate(): Date | undefined {
    if (pickerMode === 'handoverDate') return parseDateStr(appearanceDate);
    return undefined;
  }

  const isDatePicker = pickerMode === 'appearanceDate' || pickerMode === 'handoverDate';

  // Cycle duration: appearance → handover
  const totalCycleMin = appearanceTime && handoverTime
    ? calcDurationFull(appearanceDate, appearanceTime, handoverDate, handoverTime)
    : null;

  // Per-section consumption
  const sectionConsumptions = sectionMeters.map(({ start, end }) => {
    if (!start || !end || !isNumericStr(start) || !isNumericStr(end)) return null;
    const val = parseFloat(end) - parseFloat(start);
    return val >= 0 ? val : null;
  });
  const totalConsumption = sectionConsumptions.every((c) => c !== null)
    ? sectionConsumptions.reduce<number>((sum, c) => sum + (c ?? 0), 0)
    : null;

  async function handleSave() {
    if (timeError) { Alert.alert('Ошибка времени', timeError); return; }

    if (!isNumericStr(extended.trainWeight)) { Alert.alert('Ошибка данных', 'Вес поезда должен быть числом'); return; }
    if (!isNumericStr(extended.axleCount)) { Alert.alert('Ошибка данных', 'Количество осей должно быть числом'); return; }
    if (!isNumericStr(extended.lunchBreakMinutes)) { Alert.alert('Ошибка данных', 'Обеденный перерыв должен быть числом'); return; }
    if (!isNumericStr(extended.checkpointOut)) { Alert.alert('Ошибка данных', 'Проследование КП при выходе должно быть числом'); return; }
    if (!isNumericStr(extended.checkpointIn)) { Alert.alert('Ошибка данных', 'Проследование КП при заходе должно быть числом'); return; }

    const meterErr = validateSectionMeters(sectionMeters);
    if (meterErr) { Alert.alert('Ошибка счётчиков', meterErr); return; }

    const combinedNotes = buildNotes(userNotes, extended);
    // Derive trip date/time from work-cycle timestamps
    const derivedDate = appearanceDate;
    const derivedEndDate = handoverDate !== appearanceDate ? handoverDate : undefined;
    const cycleMin = (appearanceTime && handoverTime)
      ? calcDurationFull(appearanceDate, appearanceTime, handoverDate, handoverTime) ?? undefined
      : undefined;
    const result = CreateTripDtoSchema.safeParse({
      ...fields,
      date: derivedDate,
      endDate: derivedEndDate,
      startTime: appearanceTime || undefined,
      endTime: handoverTime || undefined,
      durationMinutes: cycleMin,
      notes: combinedNotes || undefined,
    });
    if (!result.success) {
      Alert.alert('Заполните все поля', result.error.issues.map((i) => i.message).join('\n'));
      return;
    }

    const sm0 = sectionMeters[0];
    const r0 = sectionRecuperation[0];
    const r1 = sectionRecuperation[1];
    const r2 = sectionRecuperation[2];
    const finalDto: LocalCreateTripDto = {
      ...result.data,
      trainNumber: extended.trainNumber || undefined,
      trainWeight: extended.trainWeight ? parseFloat(extended.trainWeight) : undefined,
      axleCount: extended.axleCount ? parseInt(extended.axleCount, 10) : undefined,
      locoModel: extended.locoModel || undefined,
      locoNumber: extended.locoNumber || undefined,
      appearanceDate: appearanceTime ? appearanceDate : undefined,
      appearanceTime: appearanceTime || undefined,
      handoverDate: handoverTime ? handoverDate : undefined,
      handoverTime: handoverTime || undefined,
      sectionCount,
      sectionMeters: sectionMeters.map((sm) => ({
        start: sm.start ? parseFloat(sm.start) : undefined,
        end: sm.end ? parseFloat(sm.end) : undefined,
      })),
      meterStart: sm0?.start ? parseFloat(sm0.start) : undefined,
      meterEnd: sm0?.end ? parseFloat(sm0.end) : undefined,
      lunchBreakMinutes: extended.lunchBreakMinutes ? parseInt(extended.lunchBreakMinutes, 10) : undefined,
      checkpointOut: extended.checkpointOut ? parseFloat(extended.checkpointOut) : undefined,
      checkpointIn: extended.checkpointIn ? parseFloat(extended.checkpointIn) : undefined,
      recuperation1Accepted: r0?.accepted ? parseFloat(r0.accepted) : undefined,
      recuperation1Delivered: r0?.delivered ? parseFloat(r0.delivered) : undefined,
      recuperation2Accepted: r1?.accepted ? parseFloat(r1.accepted) : undefined,
      recuperation2Delivered: r1?.delivered ? parseFloat(r1.delivered) : undefined,
      recuperation3Accepted: r2?.accepted ? parseFloat(r2.accepted) : undefined,
      recuperation3Delivered: r2?.delivered ? parseFloat(r2.delivered) : undefined,
    };

    setSaving(true);
    let savedOffline = false;
    try {
      await addTrip(finalDto, true);
    } catch {
      savedOffline = true;
      await addTrip(finalDto, false);
    } finally {
      setSaving(false);
    }

    if (savedOffline) {
      Alert.alert(
        'Сохранено локально',
        'Сервер недоступен. Поездка сохранена на устройстве и синхронизируется позже.',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)/trips') }],
      );
    } else {
      router.replace('/(tabs)/trips');
    }
  }

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 120 }}>
      <Text style={s.header}>Новая поездка</Text>

      {/* ─── Шаблоны ─────────────────────────────────────── */}
      {routes.length > 0 && (
        <Section>
          <Label>Шаблоны маршрутов</Label>
          <View style={{ gap: 8 }}>
            {routes.map((r) => (
              <View key={r.id} style={s.templateRow}>
                <TouchableOpacity style={s.templateChip} onPress={() => applyTemplate(r)} activeOpacity={0.75}>
                  <Text style={s.templateText} numberOfLines={1}>{r.routeFrom} → {r.routeTo}</Text>
                  <Text style={s.templateSub}>{TripTypeLabelMap[r.tripType]}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemoveTemplate(r.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={s.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* ─── Голосовой ввод ──────────────────────────────── */}
      <Section>
        <Label>Текстовый / голосовой ввод</Label>
        <TextInput
          style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]}
          placeholder="Астана – Алматы, 7 апреля, явка 08:00, сдача 16:30, грузовой"
          placeholderTextColor={C.textMute}
          multiline
          value={voiceText}
          onChangeText={setVoiceText}
        />
        <TouchableOpacity
          style={[s.btnOutline, (!voiceText.trim() || parsing) && { opacity: 0.5 }]}
          onPress={handleVoiceParse}
          disabled={!voiceText.trim() || parsing}
        >
          {parsing ? <ActivityIndicator color={C.blue} /> : <Text style={s.btnOutlineText}>Распознать</Text>}
        </TouchableOpacity>
        {voiceDraft && (
          <View style={s.draft}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: C.blue, fontSize: 13, fontWeight: '600' }}>Распознано</Text>
            </View>
            {(voiceDraft.routeFrom || voiceDraft.routeTo) && (
              <DraftRow label="Маршрут" value={[voiceDraft.routeFrom, voiceDraft.routeTo].filter(Boolean).join(' → ')} />
            )}
            {voiceDraft.date && <DraftRow label="Дата" value={voiceDraft.date} />}
            {voiceDraft.startTime && <DraftRow label="Явка" value={voiceDraft.startTime} />}
            {voiceDraft.endTime && <DraftRow label="Сдача" value={voiceDraft.endTime} />}
            {voiceDraft.tripType && <DraftRow label="Тип" value={TripTypeLabelMap[voiceDraft.tripType]} />}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={s.draftApply} onPress={applyDraft}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Применить</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.draftDiscard} onPress={() => { setVoiceDraft(null); }}>
                <Text style={{ color: C.textMute, fontSize: 13 }}>Отклонить</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Section>

      {/* ─── 1: Маршрут ──────────────────────────────────── */}
      <Section title="Маршрут" step={1}>
        <View style={s.routeHeader}>
          <Label style={{ marginTop: 0 }}>Станции</Label>
          <TouchableOpacity onPress={handleSaveTemplate} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.saveTemplate}>+ шаблон</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={s.input}
          placeholder="Станция отправления"
          placeholderTextColor={C.textMute}
          value={fields.routeFrom ?? ''}
          onChangeText={(v) => setF('routeFrom', v)}
        />
        <View style={s.divider}>
          <View style={s.divLine} /><Text style={s.divArrow}>↓</Text><View style={s.divLine} />
        </View>
        <TextInput
          style={s.input}
          placeholder="Станция прибытия"
          placeholderTextColor={C.textMute}
          value={fields.routeTo ?? ''}
          onChangeText={(v) => setF('routeTo', v)}
        />

        <Label>Тип поездки</Label>
        <View style={s.chipRow}>
          {TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[s.chip, fields.tripType === t && s.chipActive]}
              onPress={() => setF('tripType', t)}
            >
              <Text style={[s.chipText, fields.tripType === t && s.chipTextActive]}>
                {TripTypeLabelMap[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Label>Номер поезда</Label>
        <TextInput
          style={s.input}
          placeholder="Например: 1234"
          placeholderTextColor={C.textMute}
          keyboardType="numeric"
          value={extended.trainNumber}
          onChangeText={(v) => setExt('trainNumber', v)}
        />
      </Section>

      {/* ─── 2: Состав поезда ────────────────────────────── */}
      <Section title="Состав поезда" step={2}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Label style={s.colLabel}>Вес поезда, т</Label>
            <TextInput
              style={s.input}
              placeholder="0"
              placeholderTextColor={C.textMute}
              keyboardType="numeric"
              value={extended.trainWeight}
              onChangeText={(v) => setExt('trainWeight', v)}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label style={s.colLabel}>Количество осей</Label>
            <TextInput
              style={s.input}
              placeholder="0"
              placeholderTextColor={C.textMute}
              keyboardType="numeric"
              value={extended.axleCount}
              onChangeText={(v) => setExt('axleCount', v)}
            />
          </View>
        </View>
      </Section>

      {/* ─── 3: Локомотив ────────────────────────────────── */}
      <Section title="Локомотив" step={3}>
        <View style={s.row}>
          <View style={{ flex: 2 }}>
            <Label style={s.colLabel}>Серия</Label>
            <TextInput
              style={s.input}
              placeholder="ВЛ80, КЗ8А..."
              placeholderTextColor={C.textMute}
              value={extended.locoModel}
              onChangeText={(v) => setExt('locoModel', v)}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label style={s.colLabel}>Номер</Label>
            <TextInput
              style={s.input}
              placeholder="0542"
              placeholderTextColor={C.textMute}
              keyboardType="numeric"
              value={extended.locoNumber}
              onChangeText={(v) => setExt('locoNumber', v)}
            />
          </View>
        </View>

        <Label>Количество секций</Label>
        <View style={s.chipRow}>
          {([1, 2, 3] as const).map((n) => (
            <TouchableOpacity
              key={n}
              style={[s.chip, sectionCount === n && s.chipActive]}
              onPress={() => handleSectionCountChange(n)}
            >
              <Text style={[s.chipText, sectionCount === n && s.chipTextActive]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Section>

      {/* ─── 4: Явка ─────────────────────────────────────── */}
      <Section title="Явка на работу" step={4}>
        <Label>Тип явки</Label>
        <View style={s.chipRow}>
          {(['HOME', 'TURNAROUND'] as AppearanceType[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[s.chip, fields.appearanceType === t && s.chipActive]}
              onPress={() => setF('appearanceType', t)}
            >
              <Text style={[s.chipText, fields.appearanceType === t && s.chipTextActive]}>
                {AppearanceTypeLabelMap[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.row}>
          <View style={{ flex: 1.2 }}>
            <Label style={s.colLabel}>Дата явки</Label>
            <PickerBtn
              value={appearanceDate}
              placeholder="Выбрать"
              icon="calendar-outline"
              onPress={() => setPickerMode('appearanceDate')}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label style={s.colLabel}>Время явки</Label>
            <PickerBtn
              value={appearanceTime}
              placeholder="--:--"
              icon="time-outline"
              onPress={() => setPickerMode('appearanceTime')}
            />
          </View>
        </View>

        <Label>Обеденный перерыв, мин</Label>
        <TextInput
          style={s.input}
          placeholder="0"
          placeholderTextColor={C.textMute}
          keyboardType="numeric"
          value={extended.lunchBreakMinutes}
          onChangeText={(v) => setExt('lunchBreakMinutes', v)}
        />
      </Section>

      {/* ─── 5: Сдача ────────────────────────────────────── */}
      <Section title="Сдача локомотива" step={5}>
        <View style={s.row}>
          <View style={{ flex: 1.2 }}>
            <Label style={s.colLabel}>Дата сдачи</Label>
            <PickerBtn
              value={handoverDate}
              placeholder="Выбрать"
              icon="calendar-outline"
              onPress={() => setPickerMode('handoverDate')}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label style={s.colLabel}>Время сдачи</Label>
            <PickerBtn
              value={handoverTime}
              placeholder="--:--"
              icon="time-outline"
              onPress={() => setPickerMode('handoverTime')}
            />
          </View>
        </View>

        {totalCycleMin !== null && totalCycleMin > 0 && (
          <Text style={s.durationText}>Весь цикл: {formatDurMin(totalCycleMin)}</Text>
        )}

        {timeError ? <Text style={s.errorText}>{timeError}</Text> : null}
      </Section>

      {/* ─── 6: Электроэнергия ───────────────────────────── */}
      <Section title="Электроэнергия" step={6}>
        {sectionMeters.map((sm, i) => (
          <View key={i}>
            {sectionCount > 1 && (
              <Text style={s.sectionLabel}>Секция {i + 1}</Text>
            )}
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label style={s.colLabel}>Начало, кВт·ч</Label>
                <TextInput
                  style={s.input}
                  placeholder="0"
                  placeholderTextColor={C.textMute}
                  keyboardType="numeric"
                  value={sm.start}
                  onChangeText={(v) => setSectionMeter(i, 'start', v)}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Label style={s.colLabel}>Конец, кВт·ч</Label>
                <TextInput
                  style={s.input}
                  placeholder="0"
                  placeholderTextColor={C.textMute}
                  keyboardType="numeric"
                  value={sm.end}
                  onChangeText={(v) => setSectionMeter(i, 'end', v)}
                />
              </View>
            </View>
            {sectionConsumptions[i] !== null && (
              <Text style={s.calcText}>
                Расход{sectionCount > 1 ? ` (сек. ${i + 1})` : ''}: {sectionConsumptions[i]!.toFixed(0)} кВт·ч
              </Text>
            )}
            {sectionConsumptions[i] !== null && sectionConsumptions[i]! < 0 && (
              <Text style={s.warnText}>Показание на конец меньше начального</Text>
            )}
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label style={s.colLabel}>Рекуперация приёмка</Label>
                <TextInput
                  style={s.input}
                  placeholder="кВт·ч"
                  placeholderTextColor={C.textMute}
                  keyboardType="numeric"
                  value={sectionRecuperation[i]?.accepted ?? ''}
                  onChangeText={(v) => setSectionRecup(i, 'accepted', v)}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Label style={s.colLabel}>Рекуперация сдача</Label>
                <TextInput
                  style={s.input}
                  placeholder="кВт·ч"
                  placeholderTextColor={C.textMute}
                  keyboardType="numeric"
                  value={sectionRecuperation[i]?.delivered ?? ''}
                  onChangeText={(v) => setSectionRecup(i, 'delivered', v)}
                />
              </View>
            </View>
          </View>
        ))}

        {sectionCount > 1 && totalConsumption !== null && (
          <Text style={[s.durationText, { marginTop: 4 }]}>Итого: {totalConsumption.toFixed(0)} кВт·ч</Text>
        )}
      </Section>

      {/* ─── 7: Проследование КП ─────────────────────────── */}
      <Section title="Проследование КП" step={7}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Label style={s.colLabel}>При выходе</Label>
            <TextInput
              style={s.input}
              placeholder="0"
              placeholderTextColor={C.textMute}
              keyboardType="numeric"
              value={extended.checkpointOut}
              onChangeText={(v) => setExt('checkpointOut', v)}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label style={s.colLabel}>При заходе</Label>
            <TextInput
              style={s.input}
              placeholder="0"
              placeholderTextColor={C.textMute}
              keyboardType="numeric"
              value={extended.checkpointIn}
              onChangeText={(v) => setExt('checkpointIn', v)}
            />
          </View>
        </View>
      </Section>

      {/* ─── Следование пассажиром ───────────────────────── */}
      {settings?.trackPassengerTravel && (
        <Section title="Следование пассажиром">
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Label style={s.colLabel}>Выезд</Label>
              <TextInput
                style={s.input}
                placeholder="ЧЧ:ММ"
                placeholderTextColor={C.textMute}
                value={extended.passengerDepartureTime}
                onChangeText={(v) => setExt('passengerDepartureTime', v)}
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Label style={s.colLabel}>Прибытие</Label>
              <TextInput
                style={s.input}
                placeholder="ЧЧ:ММ"
                placeholderTextColor={C.textMute}
                value={extended.passengerArrivalTime}
                onChangeText={(v) => setExt('passengerArrivalTime', v)}
              />
            </View>
          </View>
        </Section>
      )}

      {/* ─── Примечание ──────────────────────────────────── */}
      <Section title="Примечание">
        <TextInput
          style={[s.input, { minHeight: 60, textAlignVertical: 'top' }]}
          placeholder="Необязательно"
          placeholderTextColor={C.textMute}
          multiline
          value={userNotes}
          onChangeText={setUserNotes}
        />
      </Section>

      {/* ─── Сохранить ───────────────────────────────────── */}
      <TouchableOpacity
        style={[s.btnPrimary, saving && { opacity: 0.5 }]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Сохранить поездку</Text>}
      </TouchableOpacity>

      {/* ─── DateTimePicker ──────────────────────────────── */}
      {Platform.OS === 'ios' && pickerMode ? (
        <Modal transparent animationType="slide" visible>
          <View style={s.iosOverlay}>
            <View style={s.iosSheet}>
              <View style={s.iosSheetHeader}>
                <Text style={s.iosSheetTitle}>{pickerLabel(pickerMode)}</Text>
                <TouchableOpacity onPress={() => setPickerMode(null)}>
                  <Text style={{ color: C.blue, fontSize: 16, fontWeight: '600' }}>Готово</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerValue()}
                mode={isDatePicker ? 'date' : 'time'}
                is24Hour
                display="spinner"
                onChange={handlePickerChange}
                minimumDate={pickerMinDate()}
              />
            </View>
          </View>
        </Modal>
      ) : pickerMode ? (
        <DateTimePicker
          value={pickerValue()}
          mode={isDatePicker ? 'date' : 'time'}
          is24Hour
          display="default"
          onChange={handlePickerChange}
          minimumDate={pickerMinDate()}
        />
      ) : null}
    </ScrollView>
  );
}

function pickerLabel(mode: PickerMode): string {
  switch (mode) {
    case 'appearanceDate': return 'Дата явки';
    case 'appearanceTime': return 'Время явки';
    case 'handoverDate': return 'Дата сдачи';
    case 'handoverTime': return 'Время сдачи';
    default: return '';
  }
}

function Section({ title, step, children }: { title?: string; step?: number; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      {title ? (
        <View style={s.sectionHeader}>
          {step !== undefined && (
            <View style={s.stepBadge}>
              <Text style={s.stepBadgeText}>{step}</Text>
            </View>
          )}
          <Text style={s.sectionTitle}>{title}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

function Label({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

function PickerBtn({
  value, placeholder, icon, onPress, highlight,
}: {
  value: string;
  placeholder: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  highlight?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.pickerField, highlight && { borderColor: C.blue, borderWidth: 1 }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[value ? s.pickerValue : s.pickerPlaceholder, { flex: 1 }]} numberOfLines={1}>
        {value || placeholder}
      </Text>
      <View style={{ flexShrink: 0, paddingLeft: 6 }}>
        <Ionicons name={icon} size={18} color={C.textDim} />
      </View>
    </TouchableOpacity>
  );
}

function DraftRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
      <Text style={{ color: C.textMute, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: C.text, fontSize: 13 }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  header: { color: C.text, fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 16 },

  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingBottom: 12, marginBottom: 4,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  stepBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.blueDark, alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '600' },
  sectionLabel: { color: C.textMute, fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { color: C.textDim, fontSize: 13, marginBottom: 5, marginTop: 10 },
  colLabel: { color: C.textDim, fontSize: 13, marginBottom: 5, marginTop: 10, minHeight: 36 },
  input: {
    backgroundColor: C.surface, color: C.text, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15,
    borderWidth: 1, borderColor: C.line,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },

  routeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  saveTemplate: { color: C.blue, fontSize: 13 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 6 },
  divLine: { flex: 1, height: 1, backgroundColor: C.line },
  divArrow: { color: C.textMute, fontSize: 16, marginHorizontal: 8 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
  },
  chipActive: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.textMute, fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  pickerField: {
    backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: C.line,
  },
  pickerValue: { color: C.text, fontSize: 15 },
  pickerPlaceholder: { color: C.textMute, fontSize: 15 },

  errorText: { color: C.danger, fontSize: 13, marginTop: 8 },
  warnText: { color: C.amber, fontSize: 13, marginTop: 4 },
  durationText: { color: C.green, fontSize: 13 },
  calcText: { color: C.green, fontSize: 13, marginTop: 4 },

  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  templateChip: {
    flex: 1, backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.line,
  },
  templateText: { color: C.text, fontSize: 14 },
  templateSub: { color: C.textMute, fontSize: 12, marginTop: 2 },
  removeText: { color: C.textMute, fontSize: 14, padding: 4 },

  draft: {
    marginTop: 12, backgroundColor: C.surface, borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: C.blueDark,
  },
  draftBadge: {
    color: C.textMute, fontSize: 11, backgroundColor: C.card,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  draftApply: { flex: 1, backgroundColor: C.blueDark, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  draftDiscard: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center' },

  btnPrimary: { backgroundColor: C.blue, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 4 },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnOutline: { borderWidth: 1, borderColor: C.blue, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
  btnOutlineText: { color: C.blue, fontSize: 15, fontWeight: '600' },

  iosOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  iosSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  iosSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  iosSheetTitle: { color: C.text, fontSize: 16, fontWeight: '600' },
});
