import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { format } from 'date-fns';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useTripsStore } from '@/store/trips.store';
import { TripType, TripTypeLabelMap } from '@railcrew/contracts';
import { LocalTrip } from '@/services/storage.service';
import { formatDateRu } from '@/utils/date';
import { filterTripsByPeriod, getPeriodBounds, PeriodKey } from '@/utils/period';
import { useLang, pluralTrips, fmtDur, Strings } from '@/i18n';
import { useTheme, Theme } from '@/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

const TRIP_TYPES: TripType[] = ['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN'];

interface FilterState {
  period: PeriodKey;
  tripType: TripType | null;
  locoFilter: string | null;
  routeFrom: string;
  routeTo: string;
  dateFrom: string;
  dateTo: string;
  unsyncedOnly: boolean;
  multiSectionOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  period: 'MONTH',
  tripType: null,
  locoFilter: null,
  routeFrom: '',
  routeTo: '',
  dateFrom: '',
  dateTo: '',
  unsyncedOnly: false,
  multiSectionOnly: false,
};

function isFilterActive(f: FilterState): boolean {
  return (
    f.period !== 'ALL' ||
    f.tripType !== null ||
    f.locoFilter !== null ||
    f.routeFrom !== '' ||
    f.routeTo !== '' ||
    f.dateFrom !== '' ||
    f.dateTo !== '' ||
    f.unsyncedOnly ||
    f.multiSectionOnly
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tripTypeColor(type: string, theme: Theme): string {
  const map: Record<string, string> = {
    FREIGHT: theme.primary,
    PASSENGER: theme.success,
    SHUNTING: theme.warning,
    DEAD_RUN: theme.textMute,
  };
  return map[type] ?? theme.textMute;
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

// ─── Filter Modal (bottom sheet) ──────────────────────────────────────────────

function FilterModal({
  visible,
  onClose,
  locoModels,
  initial,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  locoModels: string[];
  initial: FilterState;
  onApply: (state: FilterState) => void;
}) {
  const { t } = useLang();
  const { theme } = useTheme();
  const [state, setState] = useState<FilterState>(initial);

  useEffect(() => {
    if (visible) setState(initial);
  }, [visible]);

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const tripTypeLabel = (type: TripType): string => ({
    FREIGHT: t.tripType_FREIGHT,
    PASSENGER: t.tripType_PASSENGER,
    SHUNTING: t.tripType_SHUNTING,
    DEAD_RUN: t.tripType_DEAD_RUN,
  })[type] ?? type;

  const PERIOD_OPTS: { label: string; value: PeriodKey }[] = [
    { label: t.trips_all, value: 'ALL' },
    { label: t.dashboard_today, value: 'DAY' },
    { label: t.dashboard_week, value: 'WEEK' },
    { label: t.dashboard_month, value: 'MONTH' },
  ];

  function handleApply() {
    onApply(state);
    onClose();
  }

  function handleReset() {
    setState(DEFAULT_FILTERS);
  }

  const chipBase = { backgroundColor: theme.surface, borderColor: theme.border };
  const chipActive = { backgroundColor: theme.primary, borderColor: theme.primary };
  const chipTextBase = { color: theme.textMute };
  const chipTextActive = { color: '#fff', fontWeight: '600' as const };

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

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Period */}
            <Text style={[ms.sectionLabel, { color: theme.textDim }]}>{t.trips_period}</Text>
            <View style={ms.chipWrap}>
              {PERIOD_OPTS.map((p) => (
                <TouchableOpacity
                  key={p.value}
                  style={[ms.chip, chipBase, state.period === p.value && chipActive]}
                  onPress={() => set('period', p.value)}
                  activeOpacity={0.75}
                >
                  <Text style={[ms.chipText, chipTextBase, state.period === p.value && chipTextActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Trip type */}
            <Text style={[ms.sectionLabel, { color: theme.textDim }]}>{t.trips_tripType}</Text>
            <View style={ms.chipWrap}>
              <TouchableOpacity
                style={[ms.chip, chipBase, state.tripType === null && chipActive]}
                onPress={() => set('tripType', null)}
                activeOpacity={0.75}
              >
                <Text style={[ms.chipText, chipTextBase, state.tripType === null && chipTextActive]}>
                  {t.trips_all}
                </Text>
              </TouchableOpacity>
              {TRIP_TYPES.map((tripT) => (
                <TouchableOpacity
                  key={tripT}
                  style={[ms.chip, chipBase, state.tripType === tripT && chipActive]}
                  onPress={() => set('tripType', state.tripType === tripT ? null : tripT)}
                  activeOpacity={0.75}
                >
                  <Text style={[ms.chipText, chipTextBase, state.tripType === tripT && chipTextActive]}>
                    {tripTypeLabel(tripT)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Loco model */}
            {locoModels.length > 1 && (
              <>
                <Text style={[ms.sectionLabel, { color: theme.textDim }]}>{t.trips_loco}</Text>
                <View style={ms.chipWrap}>
                  <TouchableOpacity
                    style={[ms.chip, chipBase, state.locoFilter === null && chipActive]}
                    onPress={() => set('locoFilter', null)}
                    activeOpacity={0.75}
                  >
                    <Text style={[ms.chipText, chipTextBase, state.locoFilter === null && chipTextActive]}>
                      {t.trips_allLocos}
                    </Text>
                  </TouchableOpacity>
                  {locoModels.map((model) => (
                    <TouchableOpacity
                      key={model}
                      style={[ms.chip, chipBase, state.locoFilter === model && chipActive]}
                      onPress={() => set('locoFilter', state.locoFilter === model ? null : model)}
                      activeOpacity={0.75}
                    >
                      <Text style={[ms.chipText, chipTextBase, state.locoFilter === model && chipTextActive]}>
                        {model}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Route */}
            <Text style={[ms.sectionLabel, { color: theme.textDim }]}>{t.trips_stationFrom}</Text>
            <TextInput
              style={inputStyle}
              placeholder={t.trips_exFrom}
              placeholderTextColor={theme.textMute}
              value={state.routeFrom}
              onChangeText={(v) => set('routeFrom', v)}
              autoCapitalize="words"
              autoCorrect={false}
            />

            <Text style={[ms.sectionLabel, { color: theme.textDim }]}>{t.trips_stationTo}</Text>
            <TextInput
              style={inputStyle}
              placeholder={t.trips_exTo}
              placeholderTextColor={theme.textMute}
              value={state.routeTo}
              onChangeText={(v) => set('routeTo', v)}
              autoCapitalize="words"
              autoCorrect={false}
            />

            {/* Date range */}
            <Text style={[ms.sectionLabel, { color: theme.textDim }]}>{t.trips_dateFrom}</Text>
            <TextInput
              style={inputStyle}
              placeholder="2025-01-01"
              placeholderTextColor={theme.textMute}
              value={state.dateFrom}
              onChangeText={(v) => set('dateFrom', v)}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
            />

            <Text style={[ms.sectionLabel, { color: theme.textDim }]}>{t.trips_dateTo}</Text>
            <TextInput
              style={inputStyle}
              placeholder="2025-12-31"
              placeholderTextColor={theme.textMute}
              value={state.dateTo}
              onChangeText={(v) => set('dateTo', v)}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
            />

            {/* Toggle filters */}
            <View style={ms.toggleRow}>
              <TouchableOpacity
                style={[ms.toggleChip,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  state.unsyncedOnly && { backgroundColor: theme.warning, borderColor: theme.warning }]}
                onPress={() => set('unsyncedOnly', !state.unsyncedOnly)}
                activeOpacity={0.75}
              >
                <Text style={[ms.toggleText, { color: theme.textMute },
                  state.unsyncedOnly && { color: theme.bg, fontWeight: '600' }]}>
                  {t.trips_unsynced}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ms.toggleChip,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  state.multiSectionOnly && { backgroundColor: theme.warning, borderColor: theme.warning }]}
                onPress={() => set('multiSectionOnly', !state.multiSectionOnly)}
                activeOpacity={0.75}
              >
                <Text style={[ms.toggleText, { color: theme.textMute },
                  state.multiSectionOnly && { color: theme.bg, fontWeight: '600' }]}>
                  {t.trips_multiSection}
                </Text>
              </TouchableOpacity>
            </View>

          </ScrollView>

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
  const { trips, isLoading, loadLocal, syncPending, syncFromServer, deleteTrip } = useTripsStore();
  const { t } = useLang();
  const { theme } = useTheme();

  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const hasActiveFilters = isFilterActive(filters);

  const locoModels = useMemo(() => {
    const models = new Set<string>();
    for (const tr of trips) {
      if (tr.locoModel) models.add(tr.locoModel);
    }
    return Array.from(models).sort();
  }, [trips]);

  useEffect(() => {
    loadLocal();
    syncPending().catch(() => {});
    syncFromServer().catch(() => {});
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await syncFromServer();
      await syncPending();
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    let result = filterTripsByPeriod(trips, filters.period);

    if (filters.dateFrom) result = result.filter((tr) => (tr.date ?? '').slice(0, 10) >= filters.dateFrom);
    if (filters.dateTo) result = result.filter((tr) => (tr.date ?? '').slice(0, 10) <= filters.dateTo);

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

    if (filters.routeFrom) {
      const rf = filters.routeFrom.trim().toLowerCase();
      result = result.filter((tr) => tr.routeFrom.toLowerCase().includes(rf));
    }
    if (filters.routeTo) {
      const rt = filters.routeTo.trim().toLowerCase();
      result = result.filter((tr) => tr.routeTo.toLowerCase().includes(rt));
    }

    if (filters.tripType) result = result.filter((tr) => tr.tripType === filters.tripType);
    if (filters.locoFilter) result = result.filter((tr) => tr.locoModel === filters.locoFilter);
    if (filters.unsyncedOnly) result = result.filter((tr) => !tr.syncedAt);
    if (filters.multiSectionOnly) result = result.filter((tr) => (tr.sectionCount ?? 1) > 1);

    return result;
  }, [trips, filters, search]);

  const totalMinutes = useMemo(
    () => filtered.reduce((sum, tr) => sum + (tr.durationMinutes ?? 0), 0),
    [filtered],
  );

  const tripTypeLabel = (type: TripType): string => ({
    FREIGHT: t.tripType_FREIGHT,
    PASSENGER: t.tripType_PASSENGER,
    SHUNTING: t.tripType_SHUNTING,
    DEAD_RUN: t.tripType_DEAD_RUN,
  })[type] ?? type;

  async function handleExport() {
    setExporting(true);
    const bounds = getPeriodBounds(filters.period);
    const periodLabel = bounds
      ? `${bounds.from}_${bounds.to}`
      : format(new Date(), 'yyyy-MM-dd');
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
        style={[s.card, { backgroundColor: theme.card }]}
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
            <Text style={[s.typeChip, { backgroundColor: theme.surface, color: theme.primary }]}>
              {tripTypeLabel(item.tripType)}
            </Text>
            <View style={s.cardFooterRight}>
              {elec !== null && (
                <Text style={[s.elecText, { color: theme.success }]}>⚡ {elec.toFixed(0)} кВт·ч</Text>
              )}
              <Text style={[s.duration, { color: theme.textDim }]}>{fmtDur(item.durationMinutes ?? 0, t)}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const emptyText = useMemo(() => {
    if (search.trim()) return `${t.trips_emptySearch} «${search.trim()}»`;
    if (hasActiveFilters) return t.trips_emptyFilter;
    return t.trips_emptyAll;
  }, [search, hasActiveFilters, t]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: 16 }}>

      {/* Header row */}
      <View style={s.topRow}>
        <Text style={[s.header, { color: theme.text }]}>{t.trips_title}</Text>
        <View style={s.topRowActions}>
          <TouchableOpacity
            style={[s.filterBtn, { borderColor: theme.border },
              hasActiveFilters && { borderColor: theme.primary, backgroundColor: theme.primaryDim }]}
            onPress={() => setFilterModalVisible(true)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterBtnText, { color: theme.textMute },
              hasActiveFilters && { color: theme.primary }]}>
              {hasActiveFilters ? t.trips_filtersActive : t.trips_filters}
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
          refreshing={refreshing}
          onRefresh={handleRefresh}
          ListEmptyComponent={
            <Text style={[s.empty, { color: theme.textMute }]}>{emptyText}</Text>
          }
        />
      )}

      {/* Filter bottom sheet */}
      <FilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        locoModels={locoModels}
        initial={filters}
        onApply={setFilters}
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

  searchRow: { marginBottom: 8 },
  searchInput: {
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, borderWidth: 1,
  },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10, paddingHorizontal: 2,
  },
  summaryText: { fontSize: 13 },
  summaryDot: { fontSize: 13 },

  card: {
    borderRadius: 16, marginBottom: 10,
    flexDirection: 'row', overflow: 'hidden',
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
  typeChip: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  elecText: { fontSize: 12 },
  duration: { fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 16 },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, maxHeight: '90%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  toggleChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  toggleText: { fontSize: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  resetBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  resetBtnText: { fontSize: 15, fontWeight: '600' },
  applyBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  applyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
