import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Platform, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { router, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTripsStore } from '@/store/trips.store';
import { tripsApi, exportApi } from '@/services/api.service';
import { LocalTrip, LocalCreateTripDto } from '@/services/storage.service';
import { TripType, UpdateTripDtoSchema } from '@railcrew/contracts';
import { formatDateRu } from '@/utils/date';
import { useLang, fmtDur } from '@/i18n';
import { useTheme, Theme } from '@/theme';

function formatShortDatetime(date: string, time: string): string {
  try {
    const d = new Date(`${date}T${time}:00`);
    return format(d, 'd MMM · HH:mm', { locale: ru });
  } catch {
    return `${date} ${time}`;
  }
}

const TYPES: TripType[] = ['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN'];

type PickerMode =
  | 'appearanceDate' | 'appearanceTime'
  | 'handoverDate' | 'handoverTime'
  | null;

function calcDurationFull(
  startDate: string, startTime: string,
  endDate: string, endTime: string,
): number | null {
  const start = new Date(`${startDate}T${startTime}:00`);
  const end = new Date(`${endDate}T${endTime}:00`);
  const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
  return diffMin > 0 ? diffMin : null;
}

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { trips, updateTrip, deleteTrip } = useTripsStore();
  const { t } = useLang();
  const { theme } = useTheme();
  const [trip, setTrip] = useState<LocalTrip | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<LocalTrip>>({});
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [exporting, setExporting] = useState(false);

  const tripTypeLabel = (type: TripType): string => ({
    FREIGHT: t.tripType_FREIGHT,
    PASSENGER: t.tripType_PASSENGER,
    SHUNTING: t.tripType_SHUNTING,
    DEAD_RUN: t.tripType_DEAD_RUN,
  })[type] ?? type;

  useEffect(() => {
    const local = trips.find((trip) => trip.id === id || trip.localId === id);
    if (local) {
      setTrip(local);
      setDraft(local);
      return;
    }
    tripsApi.get(id).then((trip) => {
      const lt: LocalTrip = trip;
      setTrip(lt);
      setDraft(lt);
    }).catch(() => {
      Alert.alert(t.common_error, t.detail_notFound);
      router.back();
    });
  }, [id, trips]);

  function setField(key: keyof LocalTrip, value: string | number | TripType | undefined) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handlePickerChange(_: DateTimePickerEvent, selected?: Date) {
    const mode = pickerMode;
    if (Platform.OS === 'android') setPickerMode(null);
    if (!selected || !mode) return;

    if (mode === 'appearanceDate') {
      setDraft((d) => ({ ...d, appearanceDate: format(selected, 'yyyy-MM-dd') }));
      return;
    }
    if (mode === 'handoverDate') {
      setDraft((d) => ({ ...d, handoverDate: format(selected, 'yyyy-MM-dd') }));
      return;
    }
    const timeStr = format(selected, 'HH:mm');
    if (mode === 'appearanceTime') {
      setDraft((d) => ({ ...d, appearanceTime: timeStr }));
      return;
    }
    if (mode === 'handoverTime') {
      setDraft((d) => ({ ...d, handoverTime: timeStr }));
    }
  }

  function pickerDate(): Date {
    if (pickerMode === 'appearanceDate' && draft.appearanceDate) {
      const [y, m, d] = draft.appearanceDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    if (pickerMode === 'handoverDate' && draft.handoverDate) {
      const [y, m, d] = draft.handoverDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    if (pickerMode === 'appearanceTime' && draft.appearanceTime) {
      const [h, m] = draft.appearanceTime.split(':').map(Number);
      const d = new Date(); d.setHours(h, m, 0, 0); return d;
    }
    if (pickerMode === 'handoverTime' && draft.handoverTime) {
      const [h, m] = draft.handoverTime.split(':').map(Number);
      const d = new Date(); d.setHours(h, m, 0, 0); return d;
    }
    return new Date();
  }

  function handleCancelEdit() {
    setEditing(false);
    setDraft(trip ?? {});
    setPickerMode(null);
  }

  async function handleSave() {
    const draftWithDerived = { ...draft };
    if (draft.appearanceDate) {
      draftWithDerived.date = draft.appearanceDate;
      draftWithDerived.startTime = draft.appearanceTime ?? draft.startTime;
    }
    if (draft.handoverDate && draft.handoverDate !== draft.appearanceDate) {
      draftWithDerived.endDate = draft.handoverDate;
    }
    if (draft.handoverTime) {
      draftWithDerived.endTime = draft.handoverTime;
    }
    if (draft.appearanceDate && draft.appearanceTime && draft.handoverDate && draft.handoverTime) {
      const cycleMin = calcDurationFull(
        draft.appearanceDate, draft.appearanceTime,
        draft.handoverDate, draft.handoverTime,
      );
      if (cycleMin !== null) draftWithDerived.durationMinutes = cycleMin;
    }

    const result = UpdateTripDtoSchema.safeParse(draftWithDerived);
    if (!result.success) {
      Alert.alert(t.common_error, t.detail_checkData);
      return;
    }
    const patch: Partial<LocalCreateTripDto> = {
      ...result.data,
      trainNumber: draft.trainNumber ?? undefined,
      trainWeight: draft.trainWeight ?? undefined,
      axleCount: draft.axleCount ?? undefined,
      locoModel: draft.locoModel ?? undefined,
      locoNumber: draft.locoNumber ?? undefined,
      meterStart: draft.meterStart,
      meterEnd: draft.meterEnd,
      appearanceDate: draft.appearanceDate ?? undefined,
      appearanceTime: draft.appearanceTime ?? undefined,
      handoverDate: draft.handoverDate ?? undefined,
      handoverTime: draft.handoverTime ?? undefined,
      sectionCount: draft.sectionCount ?? undefined,
      sectionMeters: draft.sectionMeters,
    };
    setSaving(true);
    try {
      await updateTrip(id, patch);
      setTrip((prev) => ({ ...prev!, ...patch }));
      setEditing(false);
    } catch {
      Alert.alert(t.common_error, t.detail_saveError);
    } finally {
      setSaving(false);
    }
  }

  function handleExportPress() {
    if (!trip?.id) {
      Alert.alert(t.detail_exportUnavailable, t.detail_exportUnavailableMsg);
      return;
    }
    Alert.alert(t.detail_exportTitle, t.detail_chooseFormat, [
      { text: t.common_cancel, style: 'cancel' },
      {
        text: 'PDF',
        onPress: async () => {
          setExporting(true);
          try {
            const data = await exportApi.downloadTripPdf(trip.id!);
            const path = `${FileSystem.cacheDirectory}trip-${trip.id}.pdf`;
            await FileSystem.writeAsStringAsync(path, Buffer.from(data).toString('base64'), {
              encoding: FileSystem.EncodingType.Base64,
            });
            await Sharing.shareAsync(path, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
          } catch {
            Alert.alert(t.common_error, t.detail_exportError);
          } finally {
            setExporting(false);
          }
        },
      },
    ]);
  }

  function handleDeletePress() {
    Alert.alert(
      t.detail_deleteTitle,
      t.detail_deleteMsg,
      [
        { text: t.common_cancel, style: 'cancel' },
        {
          text: t.detail_deleteTrip,
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTrip(id);
              router.back();
            } catch {
              Alert.alert(t.common_error, t.detail_deleteError);
            }
          },
        },
      ],
    );
  }

  const isDateMode = pickerMode === 'appearanceDate' || pickerMode === 'handoverDate';
  const pickerNode = pickerMode ? (
    <DateTimePicker
      value={pickerDate()}
      mode={isDateMode ? 'date' : 'time'}
      is24Hour
      minimumDate={pickerMode === 'handoverDate' && draft.appearanceDate ? (() => {
        const [y, m, d] = draft.appearanceDate!.split('-').map(Number);
        return new Date(y, m - 1, d);
      })() : undefined}
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      onChange={handlePickerChange}
    />
  ) : null;

  if (!trip) {
    return <ActivityIndicator color={theme.primary} style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  function pickerModeLabel(mode: PickerMode): string {
    switch (mode) {
      case 'appearanceDate': return t.detail_appearanceDate;
      case 'appearanceTime': return t.detail_appearanceTime;
      case 'handoverDate': return t.detail_handoverDate;
      case 'handoverTime': return t.detail_handoverTime;
      default: return '';
    }
  }

  const totalCycleMin = trip.appearanceTime && trip.handoverTime && trip.appearanceDate && trip.handoverDate
    ? calcDurationFull(trip.appearanceDate, trip.appearanceTime, trip.handoverDate, trip.handoverTime)
    : null;

  const hasCycle = !!(trip.appearanceTime || trip.handoverTime);

  const hasSectionMeters = trip.sectionMeters && trip.sectionMeters.length > 0 &&
    trip.sectionMeters.some((sm) => sm.start !== undefined || sm.end !== undefined);
  const hasElec = hasSectionMeters || trip.meterStart !== undefined || trip.meterEnd !== undefined;

  const inputStyle = [s.input, { backgroundColor: theme.surface, color: theme.text }];
  const cardStyle = [s.card, { backgroundColor: theme.card }];

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: theme.bg }]}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <TouchableOpacity onPress={() => router.back()} style={s.back}>
        <Text style={[s.backText, { color: theme.primary }]}>{t.detail_back}</Text>
      </TouchableOpacity>

      <View style={s.titleRow}>
        <Text style={[s.title, { color: theme.text }]} numberOfLines={2}>{trip.routeFrom} — {trip.routeTo}</Text>
        <TouchableOpacity onPress={editing ? handleCancelEdit : () => setEditing(true)}>
          <Text style={[s.editBtn, { color: theme.primary }]}>{editing ? t.detail_cancel : t.detail_edit}</Text>
        </TouchableOpacity>
      </View>

      {!editing ? (
        <>
          {/* Route */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_secRoute}</SectionTitle>
            <InfoRow theme={theme} label={t.detail_tripType} value={tripTypeLabel(trip.tripType)} />
            {trip.trainNumber ? <InfoRow theme={theme} label={t.detail_trainNumber} value={trip.trainNumber} /> : null}
            <InfoRow theme={theme} label={t.detail_date} value={
              trip.endDate && trip.endDate !== trip.date
                ? `${formatDateRu(trip.date)} → ${formatDateRu(trip.endDate!)}`
                : formatDateRu(trip.date)
            } />
            {trip.durationMinutes
              ? <InfoRow theme={theme} label={t.detail_duration} value={fmtDur(trip.durationMinutes, t)} />
              : null}
          </View>

          {/* Train */}
          {(trip.trainWeight != null || trip.axleCount != null) && (
            <View style={cardStyle}>
              <SectionTitle theme={theme}>{t.detail_secTrain}</SectionTitle>
              {trip.trainWeight != null
                ? <InfoRow theme={theme} label={t.detail_trainWeight} value={String(trip.trainWeight)} />
                : null}
              {trip.axleCount != null
                ? <InfoRow theme={theme} label={t.detail_axleCount} value={String(trip.axleCount)} />
                : null}
            </View>
          )}

          {/* Loco */}
          {(trip.locoModel || trip.locoNumber || trip.sectionCount != null) && (
            <View style={cardStyle}>
              <SectionTitle theme={theme}>
                {t.detail_secLoco}{trip.sectionCount && trip.sectionCount > 1 ? ` · ${trip.sectionCount} сек.` : ''}
              </SectionTitle>
              {trip.locoModel ? <InfoRow theme={theme} label={t.detail_locoModel} value={trip.locoModel} /> : null}
              {trip.locoNumber ? <InfoRow theme={theme} label={t.detail_locoNumber} value={trip.locoNumber} /> : null}
              {trip.sectionCount != null
                ? <InfoRow theme={theme} label={t.detail_sectionCount} value={String(trip.sectionCount)} />
                : null}
            </View>
          )}

          {/* Cycle */}
          {hasCycle && (
            <View style={cardStyle}>
              <SectionTitle theme={theme}>{t.detail_secCycle}</SectionTitle>
              {trip.appearanceTime && trip.appearanceDate && (
                <CycleRow
                  theme={theme}
                  marker="▶"
                  label={t.detail_appearance}
                  datetime={formatShortDatetime(trip.appearanceDate, trip.appearanceTime)}
                />
              )}
              {trip.handoverTime && trip.handoverDate && (
                <CycleRow
                  theme={theme}
                  marker="■"
                  label={t.detail_handover}
                  datetime={formatShortDatetime(trip.handoverDate, trip.handoverTime)}
                />
              )}
              {totalCycleMin !== null && totalCycleMin > 0 && (
                <View style={[s.cycleTotalRow, { borderTopColor: theme.border }]}>
                  <Text style={[s.cycleTotalLabel, { color: theme.textDim }]}>{t.detail_totalCycle}</Text>
                  <Text style={[s.cycleTotalValue, { color: theme.success }]}>{fmtDur(totalCycleMin, t)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Electricity */}
          {hasElec && (
            <View style={cardStyle}>
              <SectionTitle theme={theme}>
                {t.detail_secElec}{trip.sectionCount && trip.sectionCount > 1 ? ` (${trip.sectionCount} сек.)` : ''}
              </SectionTitle>
              {hasSectionMeters
                ? trip.sectionMeters!.map((sm, i) => {
                    const cons = sm.start !== undefined && sm.end !== undefined && sm.end >= sm.start
                      ? sm.end - sm.start
                      : null;
                    return (
                      <View key={i} style={i > 0 ? { marginTop: 8 } : undefined}>
                        {(trip.sectionCount ?? 1) > 1 && (
                          <Text style={[s.sectionLabel, { color: theme.textMute }]}>{t.detail_section} {i + 1}</Text>
                        )}
                        {sm.start !== undefined
                          ? <InfoRow theme={theme} label={t.detail_elecStart} value={`${sm.start} кВт·ч`} />
                          : null}
                        {sm.end !== undefined
                          ? <InfoRow theme={theme} label={t.detail_elecEnd} value={`${sm.end} кВт·ч`} />
                          : null}
                        {cons !== null
                          ? <InfoRow theme={theme} label={t.detail_elecConsumption} value={`${cons.toFixed(0)} кВт·ч`} />
                          : null}
                      </View>
                    );
                  })
                : <>
                    {trip.meterStart !== undefined
                      ? <InfoRow theme={theme} label={t.detail_elecMeterStart} value={`${trip.meterStart} кВт·ч`} />
                      : null}
                    {trip.meterEnd !== undefined
                      ? <InfoRow theme={theme} label={t.detail_elecMeterEnd} value={`${trip.meterEnd} кВт·ч`} />
                      : null}
                    {trip.meterStart !== undefined && trip.meterEnd !== undefined && trip.meterEnd >= trip.meterStart
                      ? <InfoRow theme={theme} label={t.detail_elecConsumption} value={`${(trip.meterEnd - trip.meterStart).toFixed(0)} кВт·ч`} />
                      : null}
                  </>
              }
              {hasSectionMeters && (trip.sectionCount ?? 1) > 1 && (() => {
                const sms = trip.sectionMeters!;
                const allValid = sms.every((sm) => sm.start !== undefined && sm.end !== undefined && sm.end >= sm.start);
                if (!allValid) return null;
                const total = sms.reduce((sum, sm) => sum + (sm.end! - sm.start!), 0);
                return (
                  <View style={[s.cycleTotalRow, { borderTopColor: theme.border }]}>
                    <Text style={[s.cycleTotalLabel, { color: theme.textDim }]}>{t.detail_elecTotal}</Text>
                    <Text style={[s.cycleTotalValue, { color: theme.success }]}>{total.toFixed(0)} кВт·ч</Text>
                  </View>
                );
              })()}
            </View>
          )}

          {trip.notes ? (
            <View style={cardStyle}>
              <SectionTitle theme={theme}>{t.detail_secNotes}</SectionTitle>
              <Text style={[s.notesText, { color: theme.textMute }]}>{trip.notes}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[s.deleteBtn, { borderColor: theme.danger }]}
            onPress={handleDeletePress}
            activeOpacity={0.75}
          >
            <Text style={[s.deleteBtnText, { color: theme.danger }]}>{t.detail_deleteTrip}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.duplicateBtn, { borderColor: theme.border }]}
            onPress={() => router.push({
              pathname: '/(tabs)/add',
              params: {
                routeFrom: trip.routeFrom,
                routeTo: trip.routeTo,
                tripType: trip.tripType,
                trainNumber: trip.trainNumber ?? '',
                trainWeight: trip.trainWeight != null ? String(trip.trainWeight) : '',
                axleCount: trip.axleCount != null ? String(trip.axleCount) : '',
                locoModel: trip.locoModel ?? '',
                locoNumber: trip.locoNumber ?? '',
                sectionCount: trip.sectionCount != null ? String(trip.sectionCount) : '',
                notes: '',
              },
            })}
            activeOpacity={0.75}
          >
            <Text style={[s.duplicateBtnText, { color: theme.textDim }]}>{t.detail_duplicateTrip}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.exportBtn, { borderColor: theme.primaryDark }]}
            onPress={handleExportPress}
            disabled={exporting}
            activeOpacity={0.75}
          >
            {exporting
              ? <ActivityIndicator color={theme.primary} />
              : <Text style={[s.exportBtnText, { color: theme.primary }]}>{t.detail_exportPdf}</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Route edit */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_secRoute}</SectionTitle>
            <Text style={[s.label, { color: theme.textMute }]}>{t.detail_stationFrom}</Text>
            <TextInput
              style={inputStyle}
              value={draft.routeFrom ?? ''}
              onChangeText={(v) => setField('routeFrom', v)}
              placeholderTextColor={theme.textMute}
              placeholder={t.detail_from}
            />
            <View style={s.routeDivider}>
              <View style={[s.routeLine, { backgroundColor: theme.border }]} />
              <Text style={[s.routeArrow, { color: theme.textMute }]}>↓</Text>
              <View style={[s.routeLine, { backgroundColor: theme.border }]} />
            </View>
            <Text style={[s.label, { color: theme.textMute }]}>{t.detail_stationTo}</Text>
            <TextInput
              style={inputStyle}
              value={draft.routeTo ?? ''}
              onChangeText={(v) => setField('routeTo', v)}
              placeholderTextColor={theme.textMute}
              placeholder={t.detail_to}
            />

            <Text style={[s.label, { color: theme.textMute }]}>{t.detail_tripType}</Text>
            <View style={s.chipRow}>
              {TYPES.map((tripT) => (
                <TouchableOpacity
                  key={tripT}
                  style={[s.chip, { backgroundColor: theme.surface, borderColor: theme.border },
                    draft.tripType === tripT && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                  onPress={() => setField('tripType', tripT)}
                >
                  <Text style={[s.chipText, { color: theme.textMute },
                    draft.tripType === tripT && { color: '#fff', fontWeight: '600' }]}>
                    {tripTypeLabel(tripT)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.label, { color: theme.textMute }]}>{t.detail_trainNumber}</Text>
            <TextInput
              style={inputStyle}
              value={draft.trainNumber ?? ''}
              onChangeText={(v) => setField('trainNumber', v || undefined)}
              placeholderTextColor={theme.textMute}
              placeholder="1234"
              keyboardType="numeric"
            />
          </View>

          {/* Train edit */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_secTrain}</SectionTitle>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_trainWeight}</Text>
                <TextInput
                  style={inputStyle}
                  value={draft.trainWeight?.toString() ?? ''}
                  onChangeText={(v) => setField('trainWeight', v ? parseFloat(v) : undefined)}
                  placeholderTextColor={theme.textMute}
                  placeholder="0"
                  keyboardType="numeric"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_axleCount}</Text>
                <TextInput
                  style={inputStyle}
                  value={draft.axleCount?.toString() ?? ''}
                  onChangeText={(v) => setField('axleCount', v ? parseInt(v, 10) : undefined)}
                  placeholderTextColor={theme.textMute}
                  placeholder="0"
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Loco edit */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_secLoco}</SectionTitle>
            <View style={s.row}>
              <View style={{ flex: 2 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_locoModel}</Text>
                <TextInput
                  style={inputStyle}
                  value={draft.locoModel ?? ''}
                  onChangeText={(v) => setField('locoModel', v || undefined)}
                  placeholderTextColor={theme.textMute}
                  placeholder="ВЛ80, КЗ8А..."
                />
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_locoNumber}</Text>
                <TextInput
                  style={inputStyle}
                  value={draft.locoNumber ?? ''}
                  onChangeText={(v) => setField('locoNumber', v || undefined)}
                  placeholderTextColor={theme.textMute}
                  placeholder="0542"
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Appearance edit */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_appearance}</SectionTitle>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_appearanceDate}</Text>
                <TouchableOpacity
                  style={[s.pickerField, { backgroundColor: theme.surface }]}
                  onPress={() => setPickerMode('appearanceDate')}
                  activeOpacity={0.7}
                >
                  <Text style={[s.pickerValue, { color: draft.appearanceDate ? theme.text : theme.textMute }]} numberOfLines={1}>
                    {draft.appearanceDate ?? t.detail_choose}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_appearanceTime}</Text>
                <TouchableOpacity
                  style={[s.pickerField, { backgroundColor: theme.surface }]}
                  onPress={() => setPickerMode('appearanceTime')}
                  activeOpacity={0.7}
                >
                  <Text style={[s.pickerValue, { color: draft.appearanceTime ? theme.text : theme.textMute }]} numberOfLines={1}>
                    {draft.appearanceTime ?? '--:--'}
                  </Text>
                  <Ionicons name="time-outline" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
            </View>
            {(draft.appearanceDate || draft.appearanceTime) ? (
              <TouchableOpacity onPress={() => setDraft((d) => ({ ...d, appearanceDate: undefined, appearanceTime: undefined }))}>
                <Text style={[s.clearLink, { color: theme.danger }]}>{t.detail_clearAppearance}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Handover edit */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_handover}</SectionTitle>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_handoverDate}</Text>
                <TouchableOpacity
                  style={[s.pickerField, { backgroundColor: theme.surface }]}
                  onPress={() => setPickerMode('handoverDate')}
                  activeOpacity={0.7}
                >
                  <Text style={[s.pickerValue, { color: draft.handoverDate ? theme.text : theme.textMute }]} numberOfLines={1}>
                    {draft.handoverDate ?? t.detail_choose}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_handoverTime}</Text>
                <TouchableOpacity
                  style={[s.pickerField, { backgroundColor: theme.surface }]}
                  onPress={() => setPickerMode('handoverTime')}
                  activeOpacity={0.7}
                >
                  <Text style={[s.pickerValue, { color: draft.handoverTime ? theme.text : theme.textMute }]} numberOfLines={1}>
                    {draft.handoverTime ?? '--:--'}
                  </Text>
                  <Ionicons name="time-outline" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
            </View>
            {draft.appearanceDate && draft.appearanceTime && draft.handoverDate && draft.handoverTime ? (() => {
              const cycleMin = calcDurationFull(
                draft.appearanceDate, draft.appearanceTime,
                draft.handoverDate, draft.handoverTime,
              );
              return cycleMin && cycleMin > 0
                ? <Text style={[s.cycleCalcText, { color: theme.success }]}>{t.detail_cycle}: {fmtDur(cycleMin, t)}</Text>
                : <Text style={[s.timeError, { color: theme.danger }]}>{t.detail_timeError}</Text>;
            })() : null}
            {(draft.handoverDate || draft.handoverTime) ? (
              <TouchableOpacity onPress={() => setDraft((d) => ({ ...d, handoverDate: undefined, handoverTime: undefined }))}>
                <Text style={[s.clearLink, { color: theme.danger }]}>{t.detail_clearHandover}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Electricity edit */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_secElec}</SectionTitle>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_elecMeterStartLabel}</Text>
                <TextInput
                  style={inputStyle}
                  value={draft.meterStart?.toString() ?? ''}
                  onChangeText={(v) => setField('meterStart', v ? parseFloat(v) : undefined)}
                  placeholderTextColor={theme.textMute}
                  placeholder="0"
                  keyboardType="numeric"
                />
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={[s.colLabel, { color: theme.textMute }]}>{t.detail_elecMeterEndLabel}</Text>
                <TextInput
                  style={inputStyle}
                  value={draft.meterEnd?.toString() ?? ''}
                  onChangeText={(v) => setField('meterEnd', v ? parseFloat(v) : undefined)}
                  placeholderTextColor={theme.textMute}
                  placeholder="0"
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Notes edit */}
          <View style={cardStyle}>
            <SectionTitle theme={theme}>{t.detail_secNotes}</SectionTitle>
            <TextInput
              style={[inputStyle, { minHeight: 60, textAlignVertical: 'top' }]}
              value={draft.notes ?? ''}
              onChangeText={(v) => setField('notes', v || undefined)}
              placeholderTextColor={theme.textMute}
              placeholder={t.detail_notOptional}
              multiline
            />
          </View>

          <TouchableOpacity
            style={[s.btn, { backgroundColor: theme.primary }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{t.detail_saveChanges}</Text>}
          </TouchableOpacity>
        </>
      )}

      {Platform.OS === 'ios' && pickerMode ? (
        <Modal transparent animationType="slide" visible>
          <View style={s.iosOverlay}>
            <View style={[s.iosSheet, { backgroundColor: theme.card }]}>
              <View style={[s.iosSheetHeader, { borderBottomColor: theme.border }]}>
                <Text style={[s.iosSheetTitle, { color: theme.text }]}>{pickerModeLabel(pickerMode)}</Text>
                <TouchableOpacity onPress={() => setPickerMode(null)}>
                  <Text style={[s.iosSheetDone, { color: theme.primary }]}>{t.detail_iosDone}</Text>
                </TouchableOpacity>
              </View>
              {pickerNode}
            </View>
          </View>
        </Modal>
      ) : (
        pickerNode
      )}
    </ScrollView>
  );
}

function SectionTitle({ children, theme }: { children: React.ReactNode; theme: Theme }) {
  return <Text style={[s.sectionTitle, { color: theme.text }]}>{children}</Text>;
}

function InfoRow({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <View style={s.infoRow}>
      <Text style={[s.infoLabel, { color: theme.textDim }]}>{label}</Text>
      <Text style={[s.infoValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function CycleRow({ marker, label, datetime, theme }: { marker: string; label: string; datetime: string; theme: Theme }) {
  return (
    <View style={s.cycleRow}>
      <Text style={[s.cycleMarker, { color: theme.textDim }]}>{marker}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[s.cycleLabel, { color: theme.textDim }]}>{label}</Text>
        <Text style={[s.cycleDatetime, { color: theme.text }]}>{datetime}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  back: { marginTop: 48, marginBottom: 12 },
  backText: { fontSize: 15 },
  titleRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 16, gap: 12,
  },
  title: { fontSize: 20, fontWeight: 'bold', flex: 1 },
  editBtn: { fontSize: 15 },

  card: { borderRadius: 14, padding: 16, marginBottom: 12 },
  label: { fontSize: 12, marginBottom: 4, marginTop: 8 },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15,
  },
  notesText: { fontSize: 14, lineHeight: 20 },

  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 10 },
  infoRow: { marginBottom: 10 },
  infoLabel: { fontSize: 12 },
  infoValue: { fontSize: 15, marginTop: 2 },

  sectionLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },

  cycleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  cycleMarker: { fontSize: 14, width: 20, textAlign: 'center', marginTop: 2 },
  cycleLabel: { fontSize: 12 },
  cycleDatetime: { fontSize: 14, marginTop: 1 },

  cycleTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, paddingTop: 8, borderTopWidth: 1,
  },
  cycleTotalLabel: { fontSize: 13 },
  cycleTotalValue: { fontSize: 14, fontWeight: '600' },

  row: { flexDirection: 'row', alignItems: 'flex-start' },
  colLabel: { fontSize: 13, marginBottom: 5, marginTop: 10, minHeight: 36 },
  cycleCalcText: { fontSize: 13, marginTop: 6 },
  clearLink: { fontSize: 12, marginTop: 8 },

  routeDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  routeLine: { flex: 1, height: 1 },
  routeArrow: { fontSize: 16, marginHorizontal: 8 },

  pickerField: {
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  pickerValue: { fontSize: 15, flex: 1 },

  timeError: { fontSize: 13, marginTop: 6 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  chipText: { fontSize: 13 },

  btn: { borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  deleteBtn: {
    borderWidth: 1, borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 10,
  },
  deleteBtnText: { fontSize: 15, fontWeight: '600' },

  duplicateBtn: {
    borderWidth: 1, borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 10,
  },
  duplicateBtnText: { fontSize: 15, fontWeight: '600' },

  exportBtn: {
    borderWidth: 1, borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 40,
  },
  exportBtnText: { fontSize: 15, fontWeight: '600' },

  iosOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  iosSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  iosSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1,
  },
  iosSheetTitle: { fontSize: 16, fontWeight: '600' },
  iosSheetDone: { fontSize: 16, fontWeight: '600' },
});
