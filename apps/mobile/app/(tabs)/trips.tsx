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

// ─── Design tokens ───────────────────────────────────────────────────────────

const C = {
  bg: '#0B0F14',
  surface: '#111820',
  card: '#192030',
  cardHi: '#1F2A3D',
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

const TRIP_TYPE_COLORS: Record<string, string> = {
  FREIGHT: '#2472CC',
  PASSENGER: '#3BD48A',
  SHUNTING: '#F5B301',
  DEAD_RUN: '#5B6A7E',
};

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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.handle} />
          <Text style={ms.title}>{t.trips_modalTitle}</Text>

          <Text style={ms.label}>{t.trips_stationFrom}</Text>
          <TextInput
            style={ms.input}
            placeholder={t.trips_exFrom}
            placeholderTextColor={C.textMute}
            value={routeFrom}
            onChangeText={setRouteFrom}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={ms.label}>{t.trips_stationTo}</Text>
          <TextInput
            style={ms.input}
            placeholder={t.trips_exTo}
            placeholderTextColor={C.textMute}
            value={routeTo}
            onChangeText={setRouteTo}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={ms.label}>{t.trips_dateFrom}</Text>
          <TextInput
            style={ms.input}
            placeholder="2025-01-01"
            placeholderTextColor={C.textMute}
            value={dateFrom}
            onChangeText={setDateFrom}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <Text style={ms.label}>{t.trips_dateTo}</Text>
          <TextInput
            style={ms.input}
            placeholder="2025-12-31"
            placeholderTextColor={C.textMute}
            value={dateTo}
            onChangeText={setDateTo}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <Text style={ms.label}>{t.trips_tripType}</Text>
          <View style={ms.chipWrap}>
            <TouchableOpacity
              style={[ms.chip, tripType === null && ms.chipActive]}
              onPress={() => setTripType(null)}
              activeOpacity={0.75}
            >
              <Text style={[ms.chipText, tripType === null && ms.chipTextActive]}>{t.trips_all}</Text>
            </TouchableOpacity>
            {TRIP_TYPES.map((tripT) => (
              <TouchableOpacity
                key={tripT}
                style={[ms.chip, tripType === tripT && ms.chipActive]}
                onPress={() => setTripType(tripType === tripT ? null : tripT)}
                activeOpacity={0.75}
              >
                <Text style={[ms.chipText, tripType === tripT && ms.chipTextActive]}>
                  {tripTypeLabel(tripT)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={ms.actions}>
            <TouchableOpacity style={ms.resetBtn} onPress={handleReset} activeOpacity={0.75}>
              <Text style={ms.resetBtnText}>{t.trips_modalReset}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ms.applyBtn} onPress={handleApply} activeOpacity={0.75}>
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

  // ── Filter state ────────────────────────────────────────────────────────────
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

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = trips;

    const bounds = getPeriodBounds(period);
    if (bounds) result = result.filter((t) => t.date >= bounds.from && t.date <= bounds.to);

    if (modalDateFrom) result = result.filter((t) => t.date >= modalDateFrom);
    if (modalDateTo) result = result.filter((t) => t.date <= modalDateTo);

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((t) =>
        t.routeFrom.toLowerCase().includes(q) ||
        t.routeTo.toLowerCase().includes(q) ||
        (t.trainNumber?.toLowerCase().includes(q)) ||
        (t.locoModel?.toLowerCase().includes(q)) ||
        (t.locoNumber?.toLowerCase().includes(q)) ||
        (t.notes?.toLowerCase().includes(q))
      );
    }

    if (modalRouteFrom) {
      const rf = modalRouteFrom.trim().toLowerCase();
      result = result.filter((t) => t.routeFrom.toLowerCase().includes(rf));
    }
    if (modalRouteTo) {
      const rt = modalRouteTo.trim().toLowerCase();
      result = result.filter((t) => t.routeTo.toLowerCase().includes(rt));
    }

    const effectiveTripType = modalTripType ?? tripTypeFilter;
    if (effectiveTripType) result = result.filter((t) => t.tripType === effectiveTripType);

    if (locoFilter) result = result.filter((t) => t.locoModel === locoFilter);
    if (unsyncedOnly) result = result.filter((t) => !t.syncedAt);
    if (multiSectionOnly) result = result.filter((t) => (t.sectionCount ?? 1) > 1);

    return result;
  }, [trips, period, search, tripTypeFilter, locoFilter, unsyncedOnly, multiSectionOnly,
    modalRouteFrom, modalRouteTo, modalDateFrom, modalDateTo, modalTripType]);

  const totalMinutes = useMemo(
    () => filtered.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0),
    [filtered],
  );

  const locoModels = useMemo(() => {
    const models = new Set<string>();
    for (const t of trips) {
      if (t.locoModel) models.add(t.locoModel);
    }
    return Array.from(models).sort();
  }, [trips]);

  // ── Handlers ────────────────────────────────────────────────────────────────

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

  // ── Render item ─────────────────────────────────────────────────────────────

  function renderItem({ item }: { item: LocalTrip }) {
    const stripeColor = TRIP_TYPE_COLORS[item.tripType] ?? C.textMute;
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
        style={s.card}
        onPress={() => router.push(`/trip/${item.id}`)}
        onLongPress={() => handleDeleteItem(item)}
        delayLongPress={500}
        activeOpacity={0.75}
      >
        <View style={[s.typeStripe, { backgroundColor: stripeColor }]} />
        <View style={s.cardContent}>
          <View style={s.cardHeader}>
            <Text style={s.route} numberOfLines={1}>
              {item.routeFrom} — {item.routeTo}
            </Text>
            {!item.syncedAt && <View style={s.unsyncedDot} />}
          </View>
          <Text style={s.meta}>
            {formatDateRu(item.date)} · {item.appearanceTime ?? item.startTime ?? '—'}–{item.handoverTime ?? item.endTime ?? '—'}
          </Text>
          {extraParts.length > 0 && (
            <Text style={s.metaExtra} numberOfLines={1}>{extraParts.join('  ·  ')}</Text>
          )}
          <View style={s.cardFooter}>
            <Text style={s.chip}>{tripTypeLabel(item.tripType)}</Text>
            <View style={s.cardFooterRight}>
              {elec !== null && (
                <Text style={s.elecText}>⚡ {elec.toFixed(0)} кВт·ч</Text>
              )}
              <Text style={s.duration}>{fmtDur(item.durationMinutes ?? 0, t)}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ── Empty text ──────────────────────────────────────────────────────────────

  const emptyText = useMemo(() => {
    if (search.trim()) return `${t.trips_emptySearch} «${search.trim()}»`;
    if (hasActiveFilters) return t.trips_emptyFilter;
    if (period === 'ALL') return t.trips_emptyAll;
    return t.trips_emptyPeriod;
  }, [search, hasActiveFilters, period, t]);

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <View style={s.screen}>

      {/* Header row */}
      <View style={s.topRow}>
        <Text style={s.header}>{t.trips_title}</Text>
        <View style={s.topRowActions}>
          <TouchableOpacity
            style={[s.filterBtn, hasModalFilters && s.filterBtnActive]}
            onPress={() => setFilterModalVisible(true)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterBtnText, hasModalFilters && s.filterBtnTextActive]}>
              {hasModalFilters ? t.trips_filtersActive : t.trips_filters}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.exportBtn, exporting && { opacity: 0.5 }]}
            onPress={handleExport}
            disabled={exporting}
            activeOpacity={0.75}
          >
            {exporting
              ? <ActivityIndicator color={C.blue} size="small" />
              : <Text style={s.exportBtnText}>CSV</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Search input */}
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder={t.trips_search}
          placeholderTextColor={C.textMute}
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
            style={[s.filterChip, period === p.value && s.filterChipActive]}
            onPress={() => setPeriod(p.value)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterChipText, period === p.value && s.filterChipTextActive]}>
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
          style={[s.filterChip, tripTypeFilter === null && s.filterChipActive]}
          onPress={() => setTripTypeFilter(null)}
          activeOpacity={0.75}
        >
          <Text style={[s.filterChipText, tripTypeFilter === null && s.filterChipTextActive]}>
            {t.trips_allTypes}
          </Text>
        </TouchableOpacity>
        {TRIP_TYPES.map((tripT) => (
          <TouchableOpacity
            key={tripT}
            style={[s.filterChip, tripTypeFilter === tripT && s.filterChipActive]}
            onPress={() => setTripTypeFilter(tripTypeFilter === tripT ? null : tripT)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterChipText, tripTypeFilter === tripT && s.filterChipTextActive]}>
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
            style={[s.filterChip, locoFilter === null && s.filterChipActive]}
            onPress={() => setLocoFilter(null)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterChipText, locoFilter === null && s.filterChipTextActive]}>
              {t.trips_allLocos}
            </Text>
          </TouchableOpacity>
          {locoModels.map((model) => (
            <TouchableOpacity
              key={model}
              style={[s.filterChip, locoFilter === model && s.filterChipActive]}
              onPress={() => setLocoFilter(locoFilter === model ? null : model)}
              activeOpacity={0.75}
            >
              <Text style={[s.filterChipText, locoFilter === model && s.filterChipTextActive]}>
                {model}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Toggle row: unsynced, multi-section, clear */}
      <View style={s.toggleRow}>
        <TouchableOpacity
          style={[s.toggleChip, unsyncedOnly && s.toggleChipActive]}
          onPress={() => setUnsyncedOnly((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={[s.toggleChipText, unsyncedOnly && s.toggleChipTextActive]}>
            {t.trips_unsynced}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleChip, multiSectionOnly && s.toggleChipActive]}
          onPress={() => setMultiSectionOnly((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={[s.toggleChipText, multiSectionOnly && s.toggleChipTextActive]}>
            {t.trips_multiSection}
          </Text>
        </TouchableOpacity>
        {hasActiveFilters && (
          <TouchableOpacity style={s.clearBtn} onPress={clearFilters} activeOpacity={0.75}>
            <Text style={s.clearBtnText}>{t.trips_clear}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Summary row */}
      {filtered.length > 0 && (
        <View style={s.summary}>
          <Text style={s.summaryText}>
            {filtered.length} {pluralTrips(filtered.length, t)}
          </Text>
          <Text style={s.summaryDot}>·</Text>
          <Text style={s.summaryText}>{fmtDur(totalMinutes, t)}</Text>
        </View>
      )}

      {/* List */}
      {isLoading ? (
        <ActivityIndicator color={C.blue} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.localId ?? t.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={s.empty}>{emptyText}</Text>
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
  screen: { flex: 1, backgroundColor: C.bg, padding: 16 },

  topRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 48, marginBottom: 10,
  },
  header: { color: C.text, fontSize: 24, fontWeight: 'bold' },
  topRowActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  filterBtn: {
    borderWidth: 1, borderColor: C.line, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center',
  },
  filterBtnActive: { borderColor: C.blue, backgroundColor: C.blueDim },
  filterBtnText: { color: C.textMute, fontSize: 13, fontWeight: '600' },
  filterBtnTextActive: { color: C.blue },
  exportBtn: {
    borderWidth: 1, borderColor: C.line, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 44, alignItems: 'center',
  },
  exportBtnText: { color: C.textMute, fontSize: 13, fontWeight: '600' },

  searchRow: { marginBottom: 10 },
  searchInput: {
    backgroundColor: C.card, color: C.text, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    borderWidth: 1, borderColor: C.line,
  },

  chipScrollView: { flexGrow: 0, marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
  },
  filterChipActive: { backgroundColor: C.blue, borderColor: C.blue },
  filterChipText: { color: C.textMute, fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },

  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' },
  toggleChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
  },
  toggleChipActive: { backgroundColor: C.amber, borderColor: C.amber },
  toggleChipText: { color: C.textMute, fontSize: 12 },
  toggleChipTextActive: { color: C.bg, fontWeight: '600' },
  clearBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.danger,
  },
  clearBtnText: { color: C.danger, fontSize: 12 },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10, paddingHorizontal: 2,
  },
  summaryText: { color: C.textDim, fontSize: 13 },
  summaryDot: { color: C.line, fontSize: 13 },

  card: {
    backgroundColor: C.card, borderRadius: 14, marginBottom: 10,
    flexDirection: 'row', overflow: 'hidden',
  },
  typeStripe: { width: 4 },
  cardContent: { flex: 1, padding: 16 },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: 8,
  },
  route: { color: C.text, fontSize: 16, fontWeight: '600', flex: 1 },
  unsyncedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.amber, flexShrink: 0 },
  meta: { color: C.textMute, fontSize: 13, marginTop: 4 },
  metaExtra: { color: C.textMute, fontSize: 12, marginTop: 3 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  cardFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: {
    backgroundColor: C.surface, color: C.blue, fontSize: 12,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  elecText: { color: C.green, fontSize: 12 },
  duration: { color: C.textDim, fontSize: 16, fontWeight: '600' },
  empty: { color: C.textMute, textAlign: 'center', marginTop: 60, fontSize: 16 },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  overlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.line,
    alignSelf: 'center', marginBottom: 16,
  },
  title: { color: C.text, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { color: C.textDim, fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: C.surface, color: C.text, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    borderWidth: 1, borderColor: C.line,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
  },
  chipActive: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.textMute, fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  resetBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: C.line, alignItems: 'center',
  },
  resetBtnText: { color: C.textDim, fontSize: 15, fontWeight: '600' },
  applyBtn: {
    flex: 2, paddingVertical: 12, borderRadius: 10,
    backgroundColor: C.blue, alignItems: 'center',
  },
  applyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
