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
  LocalCreateTripDto, LocalSegment,
} from '@/services/storage.service';
import { CreateTripDto, TripType, TripTypeLabelMap, CreateTripDtoSchema, AppearanceType } from '@railcrew/contracts';
import { todayISO } from '@/utils/date';
import { useLang, fmtDur } from '@/i18n';
import { useTheme, Theme } from '@/theme';

const TYPES: TripType[] = ['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN'];

type SegmentType = 'DRIVING' | 'PASSENGER' | 'RESERVE' | 'WAITING' | 'TARIFF';
const SEGMENT_TYPES: SegmentType[] = ['DRIVING', 'PASSENGER', 'RESERVE', 'WAITING', 'TARIFF'];

type SegmentDraft = {
  segmentType: SegmentType;
  startTime: string;
  endTime: string;
  distanceKm: string;
  trainWeightTons: string;
  notes: string;
};

const DEFAULT_SEG_DRAFT: SegmentDraft = {
  segmentType: 'DRIVING',
  startTime: '',
  endTime: '',
  distanceKm: '',
  trainWeightTons: '',
  notes: '',
};

const SEG_COLORS: Record<SegmentType, string> = {
  DRIVING: '#3B82F6',
  PASSENGER: '#10B981',
  RESERVE: '#F59E0B',
  WAITING: '#6B7280',
  TARIFF: '#8B5CF6',
};

function segTypeLabel(
  type: string,
  t: { segmentType_DRIVING: string; segmentType_PASSENGER: string; segmentType_RESERVE: string; segmentType_WAITING: string; segmentType_TARIFF: string },
): string {
  const map: Record<string, string> = {
    DRIVING: t.segmentType_DRIVING,
    PASSENGER: t.segmentType_PASSENGER,
    RESERVE: t.segmentType_RESERVE,
    WAITING: t.segmentType_WAITING,
    TARIFF: t.segmentType_TARIFF,
  };
  return map[type] ?? type;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function calcDurationFull(startDate: string, startTime: string, endDate: string, endTime: string): number | null {
  const start = new Date(`${startDate}T${startTime}:00`);
  const end = new Date(`${endDate}T${endTime}:00`);
  const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
  return diffMin > 0 ? diffMin : null;
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
  | 'checkpointOut' | 'checkpointIn'
  | 'passengerDepart' | 'passengerArrive'
  | null;

type SectionMeterStr = { start: string; end: string };

type SectionRecuperationStr = { accepted: string; delivered: string };

type ExtendedFields = {
  trainNumber: string;
  trainWeight: string;
  axleCount: string;
  conditionalLength: string;
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
  const { t } = useLang();
  const { theme } = useTheme();

  const params = useLocalSearchParams<{
    routeFrom?: string; routeTo?: string; tripType?: TripType; notes?: string;
    trainNumber?: string; trainWeight?: string; axleCount?: string;
    locoModel?: string; locoNumber?: string; sectionCount?: string;
  }>();

  const today = todayISO();

  const [fields, setFields] = useState<Partial<CreateTripDto>>({
    status: 'CONFIRMED',
    ...(params.routeFrom ? { routeFrom: params.routeFrom } : {}),
    ...(params.routeTo ? { routeTo: params.routeTo } : {}),
    ...(params.tripType ? { tripType: params.tripType } : {}),
  });

  const [extended, setExtended] = useState<ExtendedFields>({
    trainNumber: params.trainNumber ?? '',
    trainWeight: params.trainWeight ?? '',
    axleCount: params.axleCount ?? '',
    conditionalLength: '',
    locoModel: params.locoModel ?? '',
    locoNumber: params.locoNumber ?? '',
    lunchBreakMinutes: '',
    checkpointOut: '',
    checkpointIn: '',
    passengerDepartureTime: '',
    passengerArrivalTime: '',
  });

  const [appearanceDate, setAppearanceDate] = useState(today);
  const [appearanceTime, setAppearanceTime] = useState('');
  const [handoverDate, setHandoverDate] = useState(today);
  const [handoverTime, setHandoverTime] = useState('');

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
  const [saving, setSaving] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [timeError, setTimeError] = useState('');
  const [routes, setRoutes] = useState<LocalRoute[]>([]);
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [segments, setSegments] = useState<LocalSegment[]>([]);
  const [segmentModal, setSegmentModal] = useState(false);
  const [editingSegmentIdx, setEditingSegmentIdx] = useState<number | null>(null);
  const [segDraft, setSegDraft] = useState<SegmentDraft>({ ...DEFAULT_SEG_DRAFT });
  const [segPickerField, setSegPickerField] = useState<'start' | 'end' | null>(null);
  const { addTrip } = useTripsStore();

  // Collapsible sections — 1, 2, 3 open by default; 4–7 collapsed
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([1, 2, 3]));

  function toggleSection(step: number) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  const currentStep = openSections.size > 0 ? Math.max(...Array.from(openSections)) : 1;

  const isFormReady = !!(
    fields.routeFrom?.trim() &&
    fields.routeTo?.trim() &&
    fields.tripType &&
    appearanceTime &&
    handoverTime &&
    !timeError
  );

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

  useEffect(() => {
    if (appearanceTime && handoverTime) {
      const dur = calcDurationFull(appearanceDate, appearanceTime, handoverDate, handoverTime);
      setTimeError(dur === null ? t.add_timeError : '');
    } else {
      setTimeError('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceDate, appearanceTime, handoverDate, handoverTime, t]);

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

  function openAddSegment() {
    setEditingSegmentIdx(null);
    setSegDraft({ ...DEFAULT_SEG_DRAFT });
    setSegmentModal(true);
  }

  function openEditSegment(idx: number) {
    const seg = segments[idx];
    setEditingSegmentIdx(idx);
    setSegDraft({
      segmentType: seg.segmentType as SegmentType,
      startTime: seg.startTime,
      endTime: seg.endTime,
      distanceKm: seg.distanceKm != null ? String(seg.distanceKm) : '',
      trainWeightTons: seg.trainWeightTons != null ? String(seg.trainWeightTons) : '',
      notes: seg.notes ?? '',
    });
    setSegmentModal(true);
  }

  function closeSegmentModal() {
    setSegmentModal(false);
    setSegPickerField(null);
  }

  function handleSegPickerChange(_: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setSegPickerField(null);
    if (!selected || !segPickerField) return;
    setSegDraft((prev) => ({
      ...prev,
      [segPickerField === 'start' ? 'startTime' : 'endTime']: format(selected, 'HH:mm'),
    }));
  }

  function segPickerValue(): Date {
    const timeStr = segPickerField === 'start' ? segDraft.startTime : segDraft.endTime;
    return timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? parseTimeStr(timeStr) : new Date();
  }

  function segDraftDurationMin(): number | null {
    const { startTime, endTime } = segDraft;
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return null;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff <= 0) diff += 24 * 60;
    return diff;
  }

  function saveSegment() {
    const { segmentType, startTime, endTime, distanceKm, trainWeightTons, notes } = segDraft;
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      Alert.alert(t.common_error, 'Укажите время начала и окончания');
      return;
    }
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    let durationMinutes = endMin - startMin;
    if (durationMinutes <= 0) durationMinutes += 24 * 60;

    const startDate = appearanceDate;
    const endDate = endMin <= startMin
      ? format(new Date(new Date(`${startDate}T00:00:00`).getTime() + 86400000), 'yyyy-MM-dd')
      : undefined;

    const newSeg: LocalSegment = {
      id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      order: editingSegmentIdx !== null ? segments[editingSegmentIdx].order : segments.length,
      segmentType,
      startTime,
      endTime,
      startDate,
      endDate,
      durationMinutes,
      distanceKm: distanceKm ? parseFloat(distanceKm) : undefined,
      trainWeightTons: trainWeightTons ? parseFloat(trainWeightTons) : undefined,
      notes: notes.trim() || undefined,
    };

    if (editingSegmentIdx !== null) {
      setSegments((prev) => prev.map((s, i) => i === editingSegmentIdx ? newSeg : s));
    } else {
      setSegments((prev) => [...prev, newSeg]);
    }
    closeSegmentModal();
  }

  function applyTemplate(route: LocalRoute) {
    setFields((f) => ({ ...f, routeFrom: route.routeFrom, routeTo: route.routeTo, tripType: route.tripType }));
  }

  async function handleSaveTemplate() {
    const { routeFrom, routeTo, tripType } = fields;
    if (!routeFrom?.trim() || !routeTo?.trim() || !tripType) {
      Alert.alert(t.add_fillRoute, t.add_fillRouteMsg);
      return;
    }
    const saved = await localRoutesStorage.save({ routeFrom, routeTo, tripType });
    setRoutes((prev) => (prev.find((r) => r.id === saved.id) ? prev : [saved, ...prev]));
    Alert.alert(t.common_done, t.add_templateSaved);
  }

  async function handleRemoveTemplate(id: string) {
    await localRoutesStorage.remove(id);
    setRoutes((prev) => prev.filter((r) => r.id !== id));
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
      case 'checkpointOut':
        setExt('checkpointOut', format(selected, 'HH:mm'));
        break;
      case 'checkpointIn':
        setExt('checkpointIn', format(selected, 'HH:mm'));
        break;
      case 'passengerDepart':
        setExt('passengerDepartureTime', format(selected, 'HH:mm'));
        break;
      case 'passengerArrive':
        setExt('passengerArrivalTime', format(selected, 'HH:mm'));
        break;
    }
  }

  function pickerValue(): Date {
    switch (pickerMode) {
      case 'appearanceDate': return parseDateStr(appearanceDate);
      case 'appearanceTime': return appearanceTime ? parseTimeStr(appearanceTime) : new Date();
      case 'handoverDate': return parseDateStr(handoverDate);
      case 'handoverTime': return handoverTime ? parseTimeStr(handoverTime) : new Date();
      case 'checkpointOut': return extended.checkpointOut ? parseTimeStr(extended.checkpointOut) : new Date();
      case 'checkpointIn': return extended.checkpointIn ? parseTimeStr(extended.checkpointIn) : new Date();
      case 'passengerDepart': return extended.passengerDepartureTime ? parseTimeStr(extended.passengerDepartureTime) : new Date();
      case 'passengerArrive': return extended.passengerArrivalTime ? parseTimeStr(extended.passengerArrivalTime) : new Date();
      default: return new Date();
    }
  }

  function pickerMinDate(): Date | undefined {
    if (pickerMode === 'handoverDate') return parseDateStr(appearanceDate);
    return undefined;
  }

  function pickerLabel(mode: PickerMode): string {
    switch (mode) {
      case 'appearanceDate': return t.add_appearanceDate;
      case 'appearanceTime': return t.add_appearanceTime;
      case 'handoverDate': return t.add_handoverDate;
      case 'handoverTime': return t.add_handoverTime;
      case 'checkpointOut': return t.add_checkpointOut;
      case 'checkpointIn': return t.add_checkpointIn;
      case 'passengerDepart': return t.add_passengerDepart;
      case 'passengerArrive': return t.add_passengerArrive;
      default: return '';
    }
  }

  const isDatePicker = pickerMode === 'appearanceDate' || pickerMode === 'handoverDate';

  const totalCycleMin = appearanceTime && handoverTime
    ? calcDurationFull(appearanceDate, appearanceTime, handoverDate, handoverTime)
    : null;

  const sectionConsumptions = sectionMeters.map(({ start, end }) => {
    if (!start || !end || !isNumericStr(start) || !isNumericStr(end)) return null;
    const val = parseFloat(end) - parseFloat(start);
    return val >= 0 ? val : null;
  });
  const totalConsumption = sectionConsumptions.every((c) => c !== null)
    ? sectionConsumptions.reduce<number>((sum, c) => sum + (c ?? 0), 0)
    : null;

  const tripTypeLabel = (type: TripType): string => ({
    FREIGHT: t.tripType_FREIGHT,
    PASSENGER: t.tripType_PASSENGER,
    SHUNTING: t.tripType_SHUNTING,
    DEAD_RUN: t.tripType_DEAD_RUN,
  })[type] ?? type;

  const appearanceTypeLabel = (type: AppearanceType): string => ({
    HOME: t.appearanceType_HOME,
    TURNAROUND: t.appearanceType_TURNAROUND,
  })[type] ?? type;

  async function handleSave() {
    if (timeError) { Alert.alert(t.common_error, timeError); return; }

    if (!isNumericStr(extended.trainWeight)) { Alert.alert(t.common_error, t.add_errWeight); return; }
    if (!isNumericStr(extended.axleCount)) { Alert.alert(t.common_error, t.add_errAxle); return; }
    if (!isNumericStr(extended.lunchBreakMinutes)) { Alert.alert(t.common_error, t.add_errLunch); return; }

    const meterErr = validateSectionMeters(sectionMeters);
    if (meterErr) { Alert.alert(t.add_errMeters, meterErr); return; }

    const combinedNotes = buildNotes(userNotes, extended);
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
      Alert.alert(t.add_fillFields, result.error.issues.map((i) => i.message).join('\n'));
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
      conditionalLength: extended.conditionalLength ? parseInt(extended.conditionalLength, 10) : undefined,
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
      checkpointOut: extended.checkpointOut || undefined,
      checkpointIn: extended.checkpointIn || undefined,
      segments: segments.length > 0 ? segments : undefined,
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
        t.add_savedLocally,
        t.add_savedLocallyMsg,
        [{ text: t.common_ok, onPress: () => router.replace('/(tabs)/trips') }],
      );
    } else {
      router.replace('/(tabs)/trips');
    }
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      const sm0 = sectionMeters[0];
      const draftDto = {
        routeFrom: fields.routeFrom?.trim() || '',
        routeTo: fields.routeTo?.trim() || '',
        tripType: fields.tripType ?? 'FREIGHT',
        date: appearanceDate,
        status: 'DRAFT',
        startTime: appearanceTime || undefined,
        endTime: handoverTime || undefined,
        durationMinutes: totalCycleMin ?? undefined,
        locoModel: extended.locoModel || undefined,
        locoNumber: extended.locoNumber || undefined,
        trainNumber: extended.trainNumber || undefined,
        trainWeight: extended.trainWeight ? parseFloat(extended.trainWeight) : undefined,
        axleCount: extended.axleCount ? parseInt(extended.axleCount, 10) : undefined,
        conditionalLength: extended.conditionalLength ? parseInt(extended.conditionalLength, 10) : undefined,
        sectionCount,
        sectionMeters: sectionMeters.map((sm) => ({
          start: sm.start ? parseFloat(sm.start) : undefined,
          end: sm.end ? parseFloat(sm.end) : undefined,
        })),
        meterStart: sm0?.start ? parseFloat(sm0.start) : undefined,
        meterEnd: sm0?.end ? parseFloat(sm0.end) : undefined,
        appearanceDate: appearanceTime ? appearanceDate : undefined,
        appearanceTime: appearanceTime || undefined,
        handoverDate: handoverTime ? handoverDate : undefined,
        handoverTime: handoverTime || undefined,
        notes: userNotes.trim() || undefined,
        segments: segments.length > 0 ? segments : undefined,
      } as unknown as LocalCreateTripDto;
      await addTrip(draftDto, false);
      router.replace('/(tabs)/trips');
    } catch {
      Alert.alert(t.common_error, 'Не удалось сохранить черновик');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = [s.input, {
    backgroundColor: theme.surface, color: theme.text, borderColor: theme.border,
  }];

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: theme.bg }]}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 120 }}
    >
      <Text style={[s.header, { color: theme.text }]}>{t.add_title}</Text>

      {/* ─── Step indicator ──────────────────────────────── */}
      <View style={s.stepIndicator}>
        <Text style={[s.stepText, { color: theme.textDim }]}>
          {t.add_step} {currentStep} {t.add_of} 7
        </Text>
        <View style={[s.progressBar, { backgroundColor: theme.border }]}>
          <View style={[s.progressFill, { backgroundColor: theme.primary, width: `${Math.round((currentStep / 7) * 100)}%` as unknown as number }]} />
        </View>
      </View>

      {/* ─── Шаблоны ─────────────────────────────────────── */}
      {routes.length > 0 && (
        <Section theme={theme}>
          <Label theme={theme}>{t.add_templates}</Label>
          <View style={{ gap: 8 }}>
            {routes.map((r) => (
              <View key={r.id} style={s.templateRow}>
                <TouchableOpacity
                  style={[s.templateChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  onPress={() => applyTemplate(r)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.templateText, { color: theme.text }]} numberOfLines={1}>{r.routeFrom} → {r.routeTo}</Text>
                  <Text style={[s.templateSub, { color: theme.textMute }]}>{tripTypeLabel(r.tripType)}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemoveTemplate(r.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[s.removeText, { color: theme.textMute }]}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* ─── 1: Маршрут ──────────────────────────────────── */}
      <Section theme={theme} title={t.add_secRoute} step={1} isOpen={openSections.has(1)} onToggle={() => toggleSection(1)}>
        <View style={s.routeHeader}>
          <Label theme={theme} style={{ marginTop: 0 }}>{t.add_stations}</Label>
          <TouchableOpacity onPress={handleSaveTemplate} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[s.saveTemplate, { color: theme.primary }]}>{t.add_addTemplate}</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={inputStyle}
          placeholder={t.add_stationFrom}
          placeholderTextColor={theme.textMute}
          value={fields.routeFrom ?? ''}
          onChangeText={(v) => setF('routeFrom', v)}
        />
        <View style={s.divider}>
          <View style={[s.divLine, { backgroundColor: theme.border }]} />
          <Text style={[s.divArrow, { color: theme.textMute }]}>↓</Text>
          <View style={[s.divLine, { backgroundColor: theme.border }]} />
        </View>
        <TextInput
          style={inputStyle}
          placeholder={t.add_stationTo}
          placeholderTextColor={theme.textMute}
          value={fields.routeTo ?? ''}
          onChangeText={(v) => setF('routeTo', v)}
        />

        <Label theme={theme}>{t.add_tripType}</Label>
        <View style={s.chipRow}>
          {TYPES.map((tripT) => (
            <TouchableOpacity
              key={tripT}
              style={[s.chip, { backgroundColor: theme.surface, borderColor: theme.border },
                fields.tripType === tripT && { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={() => setF('tripType', tripT)}
            >
              <Text style={[s.chipText, { color: theme.textMute },
                fields.tripType === tripT && { color: '#fff', fontWeight: '600' }]}>
                {tripTypeLabel(tripT)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Label theme={theme}>{t.add_trainNumber}</Label>
        <TextInput
          style={inputStyle}
          placeholder={t.add_exTrainNumber}
          placeholderTextColor={theme.textMute}
          keyboardType="numeric"
          value={extended.trainNumber}
          onChangeText={(v) => setExt('trainNumber', v)}
        />
      </Section>

      {/* ─── Сегменты смены ──────────────────────────────── */}
      <Section theme={theme} title={t.add_secSegments}>
        {segments.length > 0 && (
          <View style={{ gap: 8, marginBottom: 8 }}>
            {segments.map((seg, idx) => (
              <SegmentCard
                key={seg.id}
                segment={seg}
                typeLabel={segTypeLabel(seg.segmentType, t)}
                durationStr={fmtDur(seg.durationMinutes, t)}
                theme={theme}
                onEdit={() => openEditSegment(idx)}
                onDelete={() => setSegments((prev) =>
                  prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i }))
                )}
              />
            ))}
          </View>
        )}
        <TouchableOpacity
          style={[s.addSegBtn, { borderColor: theme.primary }]}
          onPress={openAddSegment}
          activeOpacity={0.75}
        >
          <Text style={[s.addSegBtnText, { color: theme.primary }]}>{t.add_addSegment}</Text>
        </TouchableOpacity>
      </Section>

      {/* ─── 2: Состав поезда ────────────────────────────── */}
      <Section theme={theme} title={t.add_secTrain} step={2} isOpen={openSections.has(2)} onToggle={() => toggleSection(2)}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_trainWeight}</Label>
            <TextInput
              style={inputStyle}
              placeholder=""
              placeholderTextColor={theme.textMute}
              keyboardType="numeric"
              value={extended.trainWeight}
              onChangeText={(v) => setExt('trainWeight', v)}
            />
          </View>
          <View style={{ width: 10 }} />
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_axleCount}</Label>
            <TextInput
              style={inputStyle}
              placeholder=""
              placeholderTextColor={theme.textMute}
              keyboardType="numeric"
              value={extended.axleCount}
              onChangeText={(v) => setExt('axleCount', v)}
            />
          </View>
          <View style={{ width: 10 }} />
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_conditionalLength}</Label>
            <TextInput
              style={inputStyle}
              placeholder=""
              placeholderTextColor={theme.textMute}
              keyboardType="numeric"
              value={extended.conditionalLength}
              onChangeText={(v) => setExt('conditionalLength', v)}
            />
          </View>
        </View>
      </Section>

      {/* ─── 3: Локомотив ────────────────────────────────── */}
      <Section theme={theme} title={t.add_secLoco} step={3} isOpen={openSections.has(3)} onToggle={() => toggleSection(3)}>
        <View style={s.row}>
          <View style={{ flex: 2 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_locoModel}</Label>
            <TextInput
              style={inputStyle}
              placeholder={t.add_exLocoModel}
              placeholderTextColor={theme.textMute}
              value={extended.locoModel}
              onChangeText={(v) => setExt('locoModel', v)}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_locoNumber}</Label>
            <TextInput
              style={inputStyle}
              placeholder={t.add_exLocoNumber}
              placeholderTextColor={theme.textMute}
              keyboardType="numeric"
              value={extended.locoNumber}
              onChangeText={(v) => setExt('locoNumber', v)}
            />
          </View>
        </View>

        <Label theme={theme}>{t.add_sectionCount}</Label>
        <View style={s.chipRow}>
          {([1, 2, 3] as const).map((n) => (
            <TouchableOpacity
              key={n}
              style={[s.chip, { backgroundColor: theme.surface, borderColor: theme.border },
                sectionCount === n && { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={() => handleSectionCountChange(n)}
            >
              <Text style={[s.chipText, { color: theme.textMute },
                sectionCount === n && { color: '#fff', fontWeight: '600' }]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Section>

      {/* ─── 4: Явка ─────────────────────────────────────── */}
      <Section theme={theme} title={t.add_secAppearance} step={4} isOpen={openSections.has(4)} onToggle={() => toggleSection(4)}>
        <Label theme={theme}>{t.add_appearanceType}</Label>
        <View style={s.chipRow}>
          {(['HOME', 'TURNAROUND'] as AppearanceType[]).map((aType) => (
            <TouchableOpacity
              key={aType}
              style={[s.chip, { backgroundColor: theme.surface, borderColor: theme.border },
                fields.appearanceType === aType && { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={() => setF('appearanceType', aType)}
            >
              <Text style={[s.chipText, { color: theme.textMute },
                fields.appearanceType === aType && { color: '#fff', fontWeight: '600' }]}>
                {appearanceTypeLabel(aType)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.row}>
          <View style={{ flex: 1.2 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_appearanceDate}</Label>
            <PickerBtn
              theme={theme}
              value={appearanceDate}
              placeholder={t.add_choose}
              icon="calendar-outline"
              onPress={() => setPickerMode('appearanceDate')}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_appearanceTime}</Label>
            <PickerBtn
              theme={theme}
              value={appearanceTime}
              placeholder="--:--"
              icon="time-outline"
              onPress={() => setPickerMode('appearanceTime')}
            />
          </View>
        </View>

        <Label theme={theme}>{t.add_lunchBreak}</Label>
        <TextInput
          style={inputStyle}
          placeholder="0"
          placeholderTextColor={theme.textMute}
          keyboardType="numeric"
          value={extended.lunchBreakMinutes}
          onChangeText={(v) => setExt('lunchBreakMinutes', v)}
        />
      </Section>

      {/* ─── 5: Сдача ────────────────────────────────────── */}
      <Section theme={theme} title={t.add_secHandover} step={5} isOpen={openSections.has(5)} onToggle={() => toggleSection(5)}>
        <View style={s.row}>
          <View style={{ flex: 1.2 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_handoverDate}</Label>
            <PickerBtn
              theme={theme}
              value={handoverDate}
              placeholder={t.add_choose}
              icon="calendar-outline"
              onPress={() => setPickerMode('handoverDate')}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_handoverTime}</Label>
            <PickerBtn
              theme={theme}
              value={handoverTime}
              placeholder="--:--"
              icon="time-outline"
              onPress={() => setPickerMode('handoverTime')}
            />
          </View>
        </View>

        {totalCycleMin !== null && totalCycleMin > 0 && (
          <Text style={[s.durationText, { color: theme.success }]}>{t.add_totalCycle}: {fmtDur(totalCycleMin, t)}</Text>
        )}

        {timeError ? <Text style={[s.errorText, { color: theme.danger }]}>{timeError}</Text> : null}
      </Section>

      {/* ─── 6: Электроэнергия ───────────────────────────── */}
      <Section theme={theme} title={t.add_secElec} step={6} isOpen={openSections.has(6)} onToggle={() => toggleSection(6)}>
        {sectionMeters.map((sm, i) => (
          <View key={i}>
            {sectionCount > 1 && (
              <Text style={[s.sectionLabel, { color: theme.textMute }]}>{t.add_section} {i + 1}</Text>
            )}
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label theme={theme} style={s.colLabel}>{t.add_elecStart}</Label>
                <TextInput
                  style={inputStyle}
                  placeholder=""
                  placeholderTextColor={theme.textMute}
                  keyboardType="numeric"
                  value={sm.start}
                  onChangeText={(v) => setSectionMeter(i, 'start', v)}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Label theme={theme} style={s.colLabel}>{t.add_elecEnd}</Label>
                <TextInput
                  style={inputStyle}
                  placeholder=""
                  placeholderTextColor={theme.textMute}
                  keyboardType="numeric"
                  value={sm.end}
                  onChangeText={(v) => setSectionMeter(i, 'end', v)}
                />
              </View>
            </View>
            {sectionConsumptions[i] !== null && (
              <Text style={[s.calcText, { color: theme.success }]}>
                {t.add_consumption}{sectionCount > 1 ? ` (${t.add_section.toLowerCase()} ${i + 1})` : ''}: {sectionConsumptions[i]!.toFixed(0)} кВт·ч
              </Text>
            )}
            {sectionConsumptions[i] !== null && sectionConsumptions[i]! < 0 && (
              <Text style={[s.warnText, { color: theme.warning }]}>{t.add_warnMeter}</Text>
            )}
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label theme={theme} style={s.colLabel}>{t.add_recupAccepted}</Label>
                <TextInput
                  style={inputStyle}
                  placeholder="кВт·ч"
                  placeholderTextColor={theme.textMute}
                  keyboardType="numeric"
                  value={sectionRecuperation[i]?.accepted ?? ''}
                  onChangeText={(v) => setSectionRecup(i, 'accepted', v)}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Label theme={theme} style={s.colLabel}>{t.add_recupDelivered}</Label>
                <TextInput
                  style={inputStyle}
                  placeholder="кВт·ч"
                  placeholderTextColor={theme.textMute}
                  keyboardType="numeric"
                  value={sectionRecuperation[i]?.delivered ?? ''}
                  onChangeText={(v) => setSectionRecup(i, 'delivered', v)}
                />
              </View>
            </View>
          </View>
        ))}

        {sectionCount > 1 && totalConsumption !== null && (
          <Text style={[s.durationText, { color: theme.success, marginTop: 4 }]}>{t.add_totalConsumption}: {totalConsumption.toFixed(0)} кВт·ч</Text>
        )}
      </Section>

      {/* ─── 7: Проследование КП ─────────────────────────── */}
      <Section theme={theme} title={t.add_secCheckpoint} step={7} isOpen={openSections.has(7)} onToggle={() => toggleSection(7)}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_checkpointOut}</Label>
            <PickerBtn
              theme={theme}
              value={extended.checkpointOut}
              placeholder="--:--"
              icon="time-outline"
              onPress={() => setPickerMode('checkpointOut')}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label theme={theme} style={s.colLabel}>{t.add_checkpointIn}</Label>
            <PickerBtn
              theme={theme}
              value={extended.checkpointIn}
              placeholder="--:--"
              icon="time-outline"
              onPress={() => setPickerMode('checkpointIn')}
            />
          </View>
        </View>
      </Section>

      {/* ─── Следование пассажиром ───────────────────────── */}
      {settings?.trackPassengerTravel && (
        <Section theme={theme} title={t.add_secPassenger}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Label theme={theme} style={s.colLabel}>{t.add_passengerDepart}</Label>
              <PickerBtn
                theme={theme}
                value={extended.passengerDepartureTime}
                placeholder="--:--"
                icon="time-outline"
                onPress={() => setPickerMode('passengerDepart')}
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Label theme={theme} style={s.colLabel}>{t.add_passengerArrive}</Label>
              <PickerBtn
                theme={theme}
                value={extended.passengerArrivalTime}
                placeholder="--:--"
                icon="time-outline"
                onPress={() => setPickerMode('passengerArrive')}
              />
            </View>
          </View>
        </Section>
      )}

      {/* ─── Примечание ──────────────────────────────────── */}
      <Section theme={theme} title={t.add_secNotes}>
        <TextInput
          style={[inputStyle, { minHeight: 60, textAlignVertical: 'top' }]}
          placeholder={t.detail_notOptional}
          placeholderTextColor={theme.textMute}
          multiline
          value={userNotes}
          onChangeText={setUserNotes}
        />
      </Section>

      {/* ─── Заполнить позже ─────────────────────────────── */}
      <TouchableOpacity
        style={[s.btnSecondary, { borderColor: theme.border }]}
        onPress={handleSaveDraft}
        disabled={saving}
      >
        <Text style={[s.btnSecondaryText, { color: theme.textDim }]}>{t.add_saveDraft}</Text>
      </TouchableOpacity>

      {/* ─── Сохранить поездку ───────────────────────────── */}
      <TouchableOpacity
        style={[
          s.btnPrimary,
          isFormReady
            ? { backgroundColor: theme.primary }
            : { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
          saving && { opacity: 0.5 },
        ]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color={isFormReady ? '#fff' : theme.textMute} />
        ) : (
          <View style={s.btnRow}>
            {isFormReady && <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
            <Text style={[s.btnPrimaryText, { color: isFormReady ? '#fff' : theme.textMute }]}>
              {t.add_save}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* ─── Segment Form Modal ──────────────────────────── */}
      <Modal visible={segmentModal} animationType="slide" transparent onRequestClose={closeSegmentModal}>
        <View style={s.segOverlay}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
            <View style={[s.segSheet, { backgroundColor: theme.card }]}>
              <View style={s.segHeader}>
                <Text style={[s.segTitle, { color: theme.text }]}>
                  {editingSegmentIdx !== null ? t.add_segmentEdit : t.add_addSegment}
                </Text>
                <TouchableOpacity onPress={closeSegmentModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color={theme.textMute} />
                </TouchableOpacity>
              </View>

              <Label theme={theme}>{t.add_segmentType}</Label>
              <View style={s.chipRow}>
                {SEGMENT_TYPES.map((sType) => (
                  <TouchableOpacity
                    key={sType}
                    style={[s.chip, { backgroundColor: theme.surface, borderColor: theme.border },
                      segDraft.segmentType === sType && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                    onPress={() => setSegDraft((prev) => ({ ...prev, segmentType: sType }))}
                  >
                    <Text style={[s.chipText, { color: theme.textMute },
                      segDraft.segmentType === sType && { color: '#fff', fontWeight: '600' }]}>
                      {segTypeLabel(sType, t)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Label theme={theme} style={s.colLabel}>{t.add_segmentStart}</Label>
                  <PickerBtn
                    theme={theme}
                    value={segDraft.startTime}
                    placeholder="--:--"
                    icon="time-outline"
                    onPress={() => setSegPickerField('start')}
                  />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Label theme={theme} style={s.colLabel}>{t.add_segmentEnd}</Label>
                  <PickerBtn
                    theme={theme}
                    value={segDraft.endTime}
                    placeholder="--:--"
                    icon="time-outline"
                    onPress={() => setSegPickerField('end')}
                  />
                </View>
              </View>

              {segDraftDurationMin() !== null && (
                <Text style={[s.durationText, { color: theme.success, marginTop: 4 }]}>
                  {t.add_segmentDuration}: {fmtDur(segDraftDurationMin()!, t)}
                </Text>
              )}

              {segDraft.segmentType === 'DRIVING' && (
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Label theme={theme} style={s.colLabel}>{t.add_segmentDistance}</Label>
                    <TextInput
                      style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                      placeholder="0"
                      placeholderTextColor={theme.textMute}
                      keyboardType="numeric"
                      value={segDraft.distanceKm}
                      onChangeText={(v) => setSegDraft((prev) => ({ ...prev, distanceKm: v }))}
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Label theme={theme} style={s.colLabel}>{t.add_segmentWeight}</Label>
                    <TextInput
                      style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                      placeholder="0"
                      placeholderTextColor={theme.textMute}
                      keyboardType="numeric"
                      value={segDraft.trainWeightTons}
                      onChangeText={(v) => setSegDraft((prev) => ({ ...prev, trainWeightTons: v }))}
                    />
                  </View>
                </View>
              )}

              <Label theme={theme}>{t.add_segmentNotes}</Label>
              <TextInput
                style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border, minHeight: 50, textAlignVertical: 'top' }]}
                placeholder={t.detail_notOptional}
                placeholderTextColor={theme.textMute}
                multiline
                value={segDraft.notes}
                onChangeText={(v) => setSegDraft((prev) => ({ ...prev, notes: v }))}
              />

              <TouchableOpacity
                style={[s.btnPrimary, { backgroundColor: theme.primary, marginTop: 16 }]}
                onPress={saveSegment}
              >
                <Text style={[s.btnPrimaryText, { color: '#fff' }]}>{t.add_segmentSave}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ─── Segment time picker ─────────────────────────── */}
      {segPickerField !== null && (
        Platform.OS === 'ios' ? (
          <Modal transparent animationType="slide" visible>
            <View style={s.iosOverlay}>
              <View style={[s.iosSheet, { backgroundColor: theme.card }]}>
                <View style={[s.iosSheetHeader, { borderBottomColor: theme.border }]}>
                  <Text style={[s.iosSheetTitle, { color: theme.text }]}>
                    {segPickerField === 'start' ? t.add_segmentStart : t.add_segmentEnd}
                  </Text>
                  <TouchableOpacity onPress={() => setSegPickerField(null)}>
                    <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '600' }}>{t.add_iosDone}</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={segPickerValue()}
                  mode="time"
                  is24Hour
                  display="spinner"
                  onChange={handleSegPickerChange}
                />
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={segPickerValue()}
            mode="time"
            is24Hour
            display="default"
            onChange={handleSegPickerChange}
          />
        )
      )}

      {/* ─── DateTimePicker ──────────────────────────────── */}
      {Platform.OS === 'ios' && pickerMode ? (
        <Modal transparent animationType="slide" visible>
          <View style={s.iosOverlay}>
            <View style={[s.iosSheet, { backgroundColor: theme.card }]}>
              <View style={[s.iosSheetHeader, { borderBottomColor: theme.border }]}>
                <Text style={[s.iosSheetTitle, { color: theme.text }]}>{pickerLabel(pickerMode)}</Text>
                <TouchableOpacity onPress={() => setPickerMode(null)}>
                  <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '600' }}>{t.add_iosDone}</Text>
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

function Section({
  title, step, theme, children, isOpen, onToggle,
}: {
  title?: string; step?: number; theme: Theme; children: React.ReactNode;
  isOpen?: boolean; onToggle?: () => void;
}) {
  const collapsible = step !== undefined && onToggle !== undefined;
  const showContent = !collapsible || isOpen;

  return (
    <View style={[s.card, { backgroundColor: theme.card }]}>
      {title ? (
        <TouchableOpacity
          style={[s.sectionHeader, {
            borderBottomColor: showContent ? theme.border : 'transparent',
            borderBottomWidth: showContent ? 1 : 0,
            paddingBottom: showContent ? 12 : 0,
            marginBottom: showContent ? 4 : 0,
          }]}
          onPress={collapsible ? onToggle : undefined}
          activeOpacity={collapsible ? 0.7 : 1}
        >
          {step !== undefined && (
            <View style={[s.stepBadge, { backgroundColor: showContent ? theme.primaryDark : theme.textMute }]}>
              <Text style={s.stepBadgeText}>{step}</Text>
            </View>
          )}
          <Text style={[s.sectionTitle, { color: theme.text, flex: 1 }]}>{title}</Text>
          {collapsible && (
            <Ionicons
              name={isOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
              size={16}
              color={theme.textMute}
            />
          )}
        </TouchableOpacity>
      ) : null}
      {showContent ? children : null}
    </View>
  );
}

function Label({ children, style, theme }: { children: React.ReactNode; style?: object; theme: Theme }) {
  return <Text style={[s.label, { color: theme.textDim }, style]}>{children}</Text>;
}

function PickerBtn({
  value, placeholder, icon, onPress, theme,
}: {
  value: string;
  placeholder: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <TouchableOpacity
      style={[s.pickerField, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[value ? s.pickerValue : s.pickerPlaceholder,
        { color: value ? theme.text : theme.textMute, flex: 1 }]} numberOfLines={1}>
        {value || placeholder}
      </Text>
      <Ionicons name={icon} size={18} color={theme.textDim} />
    </TouchableOpacity>
  );
}

function SegmentCard({
  segment, typeLabel, durationStr, theme, onEdit, onDelete,
}: {
  segment: LocalSegment;
  typeLabel: string;
  durationStr: string;
  theme: Theme;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = SEG_COLORS[segment.segmentType as SegmentType] ?? '#6B7280';
  return (
    <TouchableOpacity
      style={[s.segCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={onEdit}
      activeOpacity={0.75}
    >
      <View style={{ flex: 1 }}>
        <View style={[s.segTypeBadge, { backgroundColor: color + '20' }]}>
          <Text style={[s.segTypeText, { color }]}>{typeLabel}</Text>
        </View>
        <Text style={[s.segTime, { color: theme.text }]}>{segment.startTime} – {segment.endTime}</Text>
        <Text style={[s.segDurText, { color: theme.textMute }]}>{durationStr}</Text>
        {segment.segmentType === 'DRIVING' && (segment.distanceKm || segment.trainWeightTons) && (
          <Text style={[s.segExtraText, { color: theme.textMute }]}>
            {[
              segment.distanceKm ? `${segment.distanceKm} км` : null,
              segment.trainWeightTons ? `${segment.trainWeightTons} т` : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        )}
      </View>
      <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={[s.segDeleteBtn, { color: theme.danger }]}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  header: { fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 12 },

  stepIndicator: { marginBottom: 16 },
  stepText: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  progressBar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },

  card: { borderRadius: 14, padding: 16, marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  stepBadge: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '600' },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, marginBottom: 5, marginTop: 10 },
  colLabel: { fontSize: 13, marginBottom: 5, marginTop: 10, minHeight: 36 },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },

  routeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  saveTemplate: { fontSize: 13 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 6 },
  divLine: { flex: 1, height: 1 },
  divArrow: { fontSize: 16, marginHorizontal: 8 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13 },

  pickerField: {
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1,
  },
  pickerValue: { fontSize: 15 },
  pickerPlaceholder: { fontSize: 15 },

  errorText: { fontSize: 13, marginTop: 8 },
  warnText: { fontSize: 13, marginTop: 4 },
  durationText: { fontSize: 13 },
  calcText: { fontSize: 13, marginTop: 4 },

  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  templateChip: {
    flex: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1,
  },
  templateText: { fontSize: 14 },
  templateSub: { fontSize: 12, marginTop: 2 },
  removeText: { fontSize: 14, padding: 4 },

  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnSecondary: { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4, marginBottom: 8, borderWidth: 1 },
  btnSecondaryText: { fontSize: 15, fontWeight: '500' },
  btnPrimary: { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 4 },
  btnPrimaryText: { fontSize: 16, fontWeight: '600' },
  iosOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  iosSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  iosSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1,
  },
  iosSheetTitle: { fontSize: 16, fontWeight: '600' },

  // Segment styles
  segCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 10,
    padding: 12, borderWidth: 1, gap: 8,
  },
  segTypeBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginBottom: 4 },
  segTypeText: { fontSize: 12, fontWeight: '600' },
  segTime: { fontSize: 14, fontWeight: '500' },
  segDurText: { fontSize: 12, marginTop: 1 },
  segExtraText: { fontSize: 12, marginTop: 1 },
  segDeleteBtn: { fontSize: 16, padding: 4 },
  addSegBtn: {
    borderWidth: 1, borderRadius: 10, padding: 10,
    alignItems: 'center', borderStyle: 'dashed',
  },
  addSegBtnText: { fontSize: 14, fontWeight: '500' },

  // Segment modal styles
  segOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  segSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 40,
  },
  segHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  segTitle: { fontSize: 17, fontWeight: '600' },
});
