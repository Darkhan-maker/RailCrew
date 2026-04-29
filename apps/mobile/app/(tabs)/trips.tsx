import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useTripsStore } from '@/store/trips.store';
import { TripType, TripTypeLabelMap } from '@railcrew/contracts';
import { LocalTrip } from '@/services/storage.service';
import { formatDateRu } from '@/utils/date';
import { useLang, pluralTrips, fmtDur, Strings } from '@/i18n';
import { useTheme, Theme } from '@/theme';
import { ListTodo, Truck, Users, Wrench, AlertCircle, Zap, Clock } from 'lucide-react-native';

// ─── Period filter ────────────────────────────────────────────────────────────

type PeriodFilter = 'ALL' | 'DAY' | 'WEEK' | 'MONTH';

function getPeriodBounds(period: PeriodFilter): { from: string; to: string } | null {
  if (period === 'ALL') return null;
  const now = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (period) {
    case 'DAY':
      return { from: fmt(now), to: fmt(now) };
    case 'WEEK':
      return {
        from: fmt(startOfWeek(now, { weekStartsOn: 1 })),
        to: fmt(endOfWeek(now, { weekStartsOn: 1 })),
      };
    case 'MONTH':
      return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
  }
}

// ─── Trip type chips ──────────────────────────────────────────────────────────

const TRIP_TYPES: TripType[] = ['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN'];

function tripTypeColor(type: string, theme: Theme): string {
  const map: Record<string, string> = {
    FREIGHT: theme.primary,
    PASSENGER: theme.success,
    SHUNTING: theme.warning,
    DEAD_RUN: theme.textMute,
  };
  return map[type] ?? theme.textMute;
}

function tripTypeIcon(type: string, color: string, size = 16): React.ReactNode {
  const props = { size, color };
  switch (type) {
    case 'FREIGHT': return <Truck {...props} />;
    case 'PASSENGER': return <Users {...props} />;
    case 'SHUNTING': return <Wrench {...props} />;
    case 'DEAD_RUN': return <AlertCircle {...props} />;
    default: return <AlertCircle {...props} />;
  }
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function computeElec(trip: LocalTrip): number | null {
  if (trip.sectionMeters && trip.sectionMeters.length > 0) {
    let total = 0;
    for (const sm of trip.sectionMeters) {
      if (sm.start === undefined || sm.end === undefined) return null;
      if (sm.end < sm.start) return null;
      total += sm.end - sm.start;
    }
    return total;
  }
  if (trip.meterStart !== undefined && trip.meterEnd !== undefined && trip.meterEnd >= trip.meterStart) {
    return trip.meterEnd - trip.meterStart;
  }
  return null;
}

function escapeCSV(val: string | number | null | undefined): string {
  const str = val == null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function tripsToCSV(trips: LocalTrip[], locally: string): string {
  const header = [
    'Дата', 'Откуда', 'Куда', 'Тип', 'Явка', 'Сдача',
    'Длительность (мин)', 'Примечание', 'Статус',
  ].join(',');

  const rows = trips.map((t) =>
    [
      t.date,
      t.routeFrom,
      t.routeTo,
      TripTypeLabelMap[t.tripType],
      t.appearanceTime ?? t.startTime,
      t.handoverTime ?? t.endTime,
      t.durationMinutes,
      t.notes ?? '',
      t.syncedAt ? 'синхронизировано' : locally,
    ].map(escapeCSV).join(','),
  );

  return [header, ...rows].join('\n');
}

async function exportToCSV(trips: LocalTrip[], periodLabel: string, t: Strings) {
  if (trips.length === 0) {
    Alert.alert(t.trips_noData, t.trips_exportNoTrips);
    return;
  }

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    Alert.alert(t.trips_unavailableTitle, t.trips_exportUnavailable);
    return;
  }

  const csv = tripsToCSV(trips, t.trips_locally);
  const fileName = `poezdki_${periodLabel}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
  const fileUri = FileSystem.cacheDirectory + fileName;

  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: t.trips_title,
    UTI: 'public.comma-separated-values-text',
  });
}

// ─── Filter modal ─────────────────────────────────────────────────────────────

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  routeFrom: string;
  routeTo: string;
  dateFrom: string;
  dateTo: string;
  tripType: TripType | null;
  onApply: (params: {
    routeFrom: string;
    routeTo: string;
    dateFrom: string;
    dateTo: string;
    tripType: TripType | null;
  }) => void;
}

function FilterModal({
  visible, onClose,
  routeFrom: initRouteFrom, routeTo: initRouteTo,
  dateFrom: initDateFrom, dateTo: initDateTo,
  tripType: initTripType,
  onApply,
}: FilterModalProps) {
  const { t } = useLang();
  const { theme } = useTheme();
  const [routeFrom, setRouteFrom] = useState(initRouteFrom);
  const [routeTo, setRouteTo] = useState(initRouteTo);
  const [dateFrom, setDateFrom] = useState(initDateFrom);
  const [dateTo, setDateTo] = useState(initDateTo);
  const [tripType, setTripType] = useState<TripType | null>(initTripType);

  useEffect(() => {
    if (visible) {
      setRouteFrom(initRouteFrom);
      setRouteTo(initRouteTo);
      setDateFrom(initDateFrom);
      setDateTo(initDateTo);
      setTripType(initTripType);
    }
  }, [visible]);

  const tripTypeLabel = (type: TripType): string => ({
    FREIGHT: t.tripType_FREIGHT,
    PASSENGER: t.tripType_PASSENGER,
    SHUNTING: t.tripType_SHUNTING,
    DEAD_RUN: t.tripType_DEAD_RUN,
  })[type] ?? type;

  function handleApply() {
    onApply({ routeFrom, routeTo, dateFrom, dateTo, tripType });
    onClose();
  }

  function handleReset() {
    setRouteFrom('');
    setRouteTo('');
    setDateFrom('');
    setDateTo('');
    setTripType(null);
  }

  const inputStyle = [ms.input, {
    backgroundColor: theme.surface,
    color: theme.text,
    borderColor: theme.border,
  }];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={ms.overlay}>
        <View style={[ms.sheet, { backgroundColor: theme.card }]}>
          <View style={[ms.handle, { backgroundColor: theme.border }]} />
          <Text style={[ms.title, { color: theme.text }]}>{t.trips_modalTitle}</Text>

          <Text style={[ms.label, { color: theme.textDim }]}>{t.trips_stationFrom}</Text>
          <TextInput
            style={inputStyle}
            placeholder={t.trips_exFrom}
            placeholderTextColor={theme.textMute}
            value={routeFrom}
            onChangeText={setRouteFrom}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={[ms.label, { color: theme.textDim }]}>{t.trips_stationTo}</Text>
          <TextInput
            style={inputStyle}
            placeholder={t.trips_exTo}
            placeholderTextColor={theme.textMute}
            value={routeTo}
            onChangeText={setRouteTo}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={[ms.label, { color: theme.textDim }]}>{t.trips_dateFrom}</Text>
          <TextInput
            style={inputStyle}
            placeholder="2025-01-01"
            placeholderTextColor={theme.textMute}
            value={dateFrom}
            onChangeText={setDateFrom}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <Text style={[ms.label, { color: theme.textDim }]}>{t.trips_dateTo}</Text>
          <TextInput
            style={inputStyle}
            placeholder="2025-12-31"
            placeholderTextColor={theme.textMute}
            value={dateTo}
            onChangeText={setDateTo}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <Text style={[ms.label, { color: theme.textDim }]}>{t.trips_tripType}</Text>
          <View style={ms.chipWrap}>
            <TouchableOpacity
              style={[ms.chip, { backgroundColor: theme.surface, borderColor: theme.border },
                tripType === null && { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={() => setTripType(null)}
              activeOpacity={0.75}
            >
              <Text style={[ms.chipText, { color: theme.textMute },
                tripType === null && { color: '#fff', fontWeight: '600' }]}>
                {t.trips_all}
              </Text>
            </TouchableOpacity>
            {TRIP_TYPES.map((tripT) => (
              <TouchableOpacity
                key={tripT}
                style={[ms.chip, { backgroundColor: theme.surface, borderColor: theme.border },
                  tripType === tripT && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                onPress={() => setTripType(tripType === tripT ? null : tripT)}
                activeOpacity={0.75}
              >
                <Text style={[ms.chipText, { color: theme.textMute },
                  tripType === tripT && { color: '#fff', fontWeight: '600' }]}>
                  {tripTypeLabel(tripT)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={ms.actions}>
            <TouchableOpacity
              style={[ms.resetBtn, { borderColor: theme.border }]}
              onPress={handleReset}
              activeOpacity={0.75}
            >
              <Text style={[ms.resetBtnText, { color: theme.textDim }]}>{t.trips_modalReset}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ms.applyBtn, { backgroundColor: theme.primary }]}
              onPress={handleApply}
              activeOpacity={0.75}
            >
              <Text style={ms.applyBtnText}>{t.trips_modalApply}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripsScreen() {
  const { trips, isLoading, loadLocal, syncPending, deleteTrip } = useTripsStore();
  const { t } = useLang();
  const { theme } = useTheme();

  const PERIOD_LABELS = useMemo(() => [
    { label: t.trips_all, value: 'ALL' as PeriodFilter },
    { label: t.dashboard_today, value: 'DAY' as PeriodFilter },
    { label: t.dashboard_week, value: 'WEEK' as PeriodFilter },
    { label: t.dashboard_month, value: 'MONTH' as PeriodFilter },
  ], [t]);

  const tripTypeLabel = (type: TripType): string => ({
    FREIGHT: t.tripType_FREIGHT,
    PASSENGER: t.tripType_PASSENGER,
    SHUNTING: t.tripType_SHUNTING,
    DEAD_RUN: t.tripType_DEAD_RUN,
  })[type] ?? type;

  const [period, setPeriod] = useState<PeriodFilter>('MONTH');
  const [search, setSearch] = useState('');
  const [tripTypeFilter, setTripTypeFilter] = useState<TripType | null>(null);
  const [locoFilter, setLocoFilter] = useState<string | null>(null);
  const [unsyncedOnly, setUnsyncedOnly] = useState(false);
  const [multiSectionOnly, setMultiSectionOnly] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [modalRouteFrom, setModalRouteFrom] = useState('');
  const [modalRouteTo, setModalRouteTo] = useState('');
  const [modalDateFrom, setModalDateFrom] = useState('');
  const [modalDateTo, setModalDateTo] = useState('');
  const [modalTripType, setModalTripType] = useState<TripType | null>(null);

  const hasModalFilters = !!(modalRouteFrom || modalRouteTo || modalDateFrom || modalDateTo || modalTripType);

  const hasActiveFilters =
    period !== 'MONTH' || search !== '' || tripTypeFilter !== null ||
    locoFilter !== null || unsyncedOnly || multiSectionOnly || hasModalFilters;

  function clearFilters() {
    setSearch('');
    setTripTypeFilter(null);
    setLocoFilter(null);
    setUnsyncedOnly(false);
    setMultiSectionOnly(false);
    setPeriod('MONTH');
    setModalRouteFrom('');
    setModalRouteTo('');
    setModalDateFrom('');
    setModalDateTo('');
    setModalTripType(null);
  }

  useEffect(() => {
    loadLocal();
    syncPending().catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let result = trips;

    const bounds = getPeriodBounds(period);
    if (bounds) result = result.filter((tr) => tr.date >= bounds.from && tr.date <= bounds.to);

    if (modalDateFrom) result = result.filter((tr) => tr.date >= modalDateFrom);
    if (modalDateTo) result = result.filter((tr) => tr.date <= modalDateTo);

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((tr) =>
        tr.routeFrom.toLowerCase().includes(q) ||
        tr.routeTo.toLowerCase().includes(q) ||
        (tr.trainNumber?.toLowerCase().includes(q)) ||
        (tr.locoModel?.toLowerCase().includes(q)) ||
        (tr.locoNumber?.toLowerCase().includes(q)) ||
        (tr.notes?.toLowerCase().includes(q))
      );
    }

    if (modalRouteFrom) {
      const rf = modalRouteFrom.trim().toLowerCase();
      result = result.filter((tr) => tr.routeFrom.toLowerCase().includes(rf));
    }
    if (modalRouteTo) {
      const rt = modalRouteTo.trim().toLowerCase();
      result = result.filter((tr) => tr.routeTo.toLowerCase().includes(rt));
    }

    const effectiveTripType = modalTripType ?? tripTypeFilter;
    if (effectiveTripType) result = result.filter((tr) => tr.tripType === effectiveTripType);

    if (locoFilter) result = result.filter((tr) => tr.locoModel === locoFilter);
    if (unsyncedOnly) result = result.filter((tr) => !tr.syncedAt);
    if (multiSectionOnly) result = result.filter((tr) => (tr.sectionCount ?? 1) > 1);

    return result;
  }, [trips, period, search, tripTypeFilter, locoFilter, unsyncedOnly, multiSectionOnly,
    modalRouteFrom, modalRouteTo, modalDateFrom, modalDateTo, modalTripType]);

  const totalMinutes = useMemo(
    () => filtered.reduce((sum, tr) => sum + (tr.durationMinutes ?? 0), 0),
    [filtered],
  );

  const locoModels = useMemo(() => {
    const models = new Set<string>();
    for (const tr of trips) {
      if (tr.locoModel) models.add(tr.locoModel);
    }
    return Array.from(models).sort();
  }, [trips]);

  async function handleExport() {
    setExporting(true);
    const periodLabel = PERIOD_LABELS.find((p) => p.value === period)?.label.toLowerCase() ?? 'all';
    try {
      await exportToCSV(filtered, periodLabel, t);
    } catch {
      Alert.alert(t.common_error, t.trips_exportError);
    } finally {
      setExporting(false);
    }
  }

  function handleDeleteItem(item: LocalTrip) {
    Alert.alert(
      t.trips_deleteTitle,
      t.trips_deleteMsg,
      [
        { text: t.common_cancel, style: 'cancel' },
        {
          text: t.detail_deleteTrip,
          style: 'destructive',
          onPress: () => deleteTrip(item.id),
        },
      ],
    );
  }

  function renderItem({ item }: { item: LocalTrip }) {
    const stripeColor = tripTypeColor(item.tripType, theme);
    const elec = computeElec(item);
    const extraParts: string[] = [];
    if (item.trainNumber) extraParts.push(`№${item.trainNumber}`);
    if (item.locoModel || item.locoNumber) {
      const loco = [item.locoModel, item.locoNumber ? `№${item.locoNumber}` : ''].filter(Boolean).join(' ');
      extraParts.push(loco);
    }
    if (item.sectionCount && item.sectionCount > 1) extraParts.push(`${item.sectionCount} сек.`);

    return (
      <TouchableOpacity
        style={[s.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        onPress={() => router.push(`/trip/${item.id}`)}
        onLongPress={() => handleDeleteItem(item)}
        delayLongPress={500}
        activeOpacity={0.75}
      >
        <View style={[s.typeStripe, { backgroundColor: stripeColor }]} />
        <View style={s.cardContent}>
          <View style={s.cardHeader}>
            <Text style={[s.route, { color: theme.text }]} numberOfLines={1}>
              {item.routeFrom} — {item.routeTo}
            </Text>
            {!item.syncedAt && <View style={[s.unsyncedDot, { backgroundColor: theme.warning }]} />}
          </View>
          <Text style={[s.meta, { color: theme.textMute }]}>
            {formatDateRu(item.date)} · {item.appearanceTime ?? item.startTime ?? '—'}–{item.handoverTime ?? item.endTime ?? '—'}
          </Text>
          {extraParts.length > 0 && (
            <Text style={[s.metaExtra, { color: theme.textMute }]} numberOfLines={1}>{extraParts.join('  ·  ')}</Text>
          )}
          <View style={s.cardFooter}>
            <View style={[s.chipRow2, { backgroundColor: theme.surface }]}>
              {tripTypeIcon(item.tripType, tripTypeColor(item.tripType, theme), 14)}
              <Text style={[s.chip, { color: theme.primary }]}>
                {tripTypeLabel(item.tripType)}
              </Text>
            </View>
            <View style={s.cardFooterRight}>
              {elec !== null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Zap size={12} color={theme.success} />
                  <Text style={[s.elecText, { color: theme.success }]}>{elec.toFixed(0)} кВт·ч</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Clock size={12} color={theme.textDim} />
                <Text style={[s.duration, { color: theme.textDim }]}>{fmtDur(item.durationMinutes ?? 0, t)}</Text>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const emptyText = useMemo(() => {
    if (search.trim()) return `${t.trips_emptySearch} «${search.trim()}»`;
    if (hasActiveFilters) return t.trips_emptyFilter;
    if (period === 'ALL') return t.trips_emptyAll;
    return t.trips_emptyPeriod;
  }, [search, hasActiveFilters, period, t]);

  const chipBase = { backgroundColor: theme.card, borderColor: theme.border };
  const chipActive = { backgroundColor: theme.primary, borderColor: theme.primary };
  const chipTextBase = { color: theme.textMute };
  const chipTextActive = { color: '#fff', fontWeight: '600' as const };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: 16 }}>

      {/* Header row */}
      <View style={s.topRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ListTodo size={22} color={theme.primary} />
          <Text style={[s.header, { color: theme.text }]}>{t.trips_title}</Text>
        </View>
        <View style={s.topRowActions}>
          <TouchableOpacity
            style={[s.filterBtn, { borderColor: theme.border },
              hasModalFilters && { borderColor: theme.primary, backgroundColor: theme.primaryDim }]}
            onPress={() => setFilterModalVisible(true)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterBtnText, { color: theme.textMute },
              hasModalFilters && { color: theme.primary }]}>
              {hasModalFilters ? t.trips_filtersActive : t.trips_filters}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.exportBtn, { borderColor: theme.border }, exporting && { opacity: 0.5 }]}
            onPress={handleExport}
            disabled={exporting}
            activeOpacity={0.75}
          >
            {exporting
              ? <ActivityIndicator color={theme.primary} size="small" />
              : <Text style={[s.exportBtnText, { color: theme.textMute }]}>CSV</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Search input */}
      <View style={s.searchRow}>
        <TextInput
          style={[s.searchInput, {
            backgroundColor: theme.card, color: theme.text, borderColor: theme.border,
          }]}
          placeholder={t.trips_search}
          placeholderTextColor={theme.textMute}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Period chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScrollView}
        contentContainerStyle={s.chipRow}
      >
        {PERIOD_LABELS.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[s.filterChip, chipBase, period === p.value && chipActive]}
            onPress={() => setPeriod(p.value)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterChipText, chipTextBase, period === p.value && chipTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Trip type chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScrollView}
        contentContainerStyle={s.chipRow}
      >
        <TouchableOpacity
          style={[s.filterChip, chipBase, tripTypeFilter === null && chipActive]}
          onPress={() => setTripTypeFilter(null)}
          activeOpacity={0.75}
        >
          <Text style={[s.filterChipText, chipTextBase, tripTypeFilter === null && chipTextActive]}>
            {t.trips_allTypes}
          </Text>
        </TouchableOpacity>
        {TRIP_TYPES.map((tripT) => (
          <TouchableOpacity
            key={tripT}
            style={[s.filterChip, chipBase, tripTypeFilter === tripT && chipActive]}
            onPress={() => setTripTypeFilter(tripTypeFilter === tripT ? null : tripT)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterChipText, chipTextBase, tripTypeFilter === tripT && chipTextActive]}>
              {tripTypeLabel(tripT)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Locomotive model chips */}
      {locoModels.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.chipScrollView}
          contentContainerStyle={s.chipRow}
        >
          <TouchableOpacity
            style={[s.filterChip, chipBase, locoFilter === null && chipActive]}
            onPress={() => setLocoFilter(null)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterChipText, chipTextBase, locoFilter === null && chipTextActive]}>
              {t.trips_allLocos}
            </Text>
          </TouchableOpacity>
          {locoModels.map((model) => (
            <TouchableOpacity
              key={model}
              style={[s.filterChip, chipBase, locoFilter === model && chipActive]}
              onPress={() => setLocoFilter(locoFilter === model ? null : model)}
              activeOpacity={0.75}
            >
              <Text style={[s.filterChipText, chipTextBase, locoFilter === model && chipTextActive]}>
                {model}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Toggle row */}
      <View style={s.toggleRow}>
        <TouchableOpacity
          style={[s.toggleChip, { backgroundColor: theme.card, borderColor: theme.border },
            unsyncedOnly && { backgroundColor: theme.warning, borderColor: theme.warning }]}
          onPress={() => setUnsyncedOnly((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={[s.toggleChipText, { color: theme.textMute },
            unsyncedOnly && { color: theme.bg, fontWeight: '600' }]}>
            {t.trips_unsynced}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleChip, { backgroundColor: theme.card, borderColor: theme.border },
            multiSectionOnly && { backgroundColor: theme.warning, borderColor: theme.warning }]}
          onPress={() => setMultiSectionOnly((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={[s.toggleChipText, { color: theme.textMute },
            multiSectionOnly && { color: theme.bg, fontWeight: '600' }]}>
            {t.trips_multiSection}
          </Text>
        </TouchableOpacity>
        {hasActiveFilters && (
          <TouchableOpacity
            style={[s.clearBtn, { borderColor: theme.danger }]}
            onPress={clearFilters}
            activeOpacity={0.75}
          >
            <Text style={[s.clearBtnText, { color: theme.danger }]}>{t.trips_clear}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Summary row */}
      {filtered.length > 0 && (
        <View style={s.summary}>
          <Text style={[s.summaryText, { color: theme.textDim }]}>
            {filtered.length} {pluralTrips(filtered.length, t)}
          </Text>
          <Text style={[s.summaryDot, { color: theme.border }]}>·</Text>
          <Text style={[s.summaryText, { color: theme.textDim }]}>{fmtDur(totalMinutes, t)}</Text>
        </View>
      )}

      {/* List */}
      {isLoading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(tr) => tr.localId ?? tr.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[s.empty, { color: theme.textMute }]}>{emptyText}</Text>
          }
        />
      )}

      {/* Filter modal */}
      <FilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        routeFrom={modalRouteFrom}
        routeTo={modalRouteTo}
        dateFrom={modalDateFrom}
        dateTo={modalDateTo}
        tripType={modalTripType}
        onApply={({ routeFrom, routeTo, dateFrom, dateTo, tripType }) => {
          setModalRouteFrom(routeFrom);
          setModalRouteTo(routeTo);
          setModalDateFrom(dateFrom);
          setModalDateTo(dateTo);
          setModalTripType(tripType);
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 48, marginBottom: 10,
  },
  header: { fontSize: 24, fontWeight: 'bold' },
  topRowActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  filterBtn: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center',
  },
  filterBtnText: { fontSize: 13, fontWeight: '600' },
  exportBtn: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 44, alignItems: 'center',
  },
  exportBtnText: { fontSize: 13, fontWeight: '600' },

  searchRow: { marginBottom: 10 },
  searchInput: {
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, borderWidth: 1,
  },

  chipScrollView: { flexGrow: 0, marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1,
  },
  filterChipText: { fontSize: 13 },

  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' },
  toggleChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  toggleChipText: { fontSize: 12 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  clearBtnText: { fontSize: 12 },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10, paddingHorizontal: 2,
  },
  summaryText: { fontSize: 13 },
  summaryDot: { fontSize: 13 },

  card: {
    borderRadius: 16, marginBottom: 10,
    flexDirection: 'row', overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  typeStripe: { width: 4 },
  cardContent: { flex: 1, padding: 16 },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: 8,
  },
  route: { fontSize: 16, fontWeight: '600', flex: 1 },
  unsyncedDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  meta: { fontSize: 13, marginTop: 4 },
  metaExtra: { fontSize: 12, marginTop: 3 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  cardFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  chipRow2: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  elecText: { fontSize: 12 },
  duration: { fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 16 },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  resetBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  resetBtnText: { fontSize: 15, fontWeight: '600' },
  applyBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  applyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
