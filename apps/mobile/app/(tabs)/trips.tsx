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
import { formatDateRu, formatDuration } from '@/utils/date';

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

const PERIOD_LABELS: { label: string; value: PeriodFilter }[] = [
  { label: 'Все', value: 'ALL' },
  { label: 'Сегодня', value: 'DAY' },
  { label: 'Неделя', value: 'WEEK' },
  { label: 'Месяц', value: 'MONTH' },
];

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

function tripsToCSV(trips: LocalTrip[]): string {
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
      t.syncedAt ? 'синхронизировано' : 'локально',
    ].map(escapeCSV).join(','),
  );

  return [header, ...rows].join('\n');
}

async function exportToCSV(trips: LocalTrip[], periodLabel: string) {
  if (trips.length === 0) {
    Alert.alert('Нет данных', 'Нет поездок для экспорта за выбранный период');
    return;
  }

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    Alert.alert('Недоступно', 'Экспорт не поддерживается на этом устройстве');
    return;
  }

  const csv = tripsToCSV(trips);
  const fileName = `poezdki_${periodLabel}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
  const fileUri = FileSystem.cacheDirectory + fileName;

  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: 'Экспорт поездок',
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
          <Text style={ms.title}>Фильтры</Text>

          <Text style={ms.label}>Станция отправления</Text>
          <TextInput
            style={ms.input}
            placeholder="Напр.: Алматы"
            placeholderTextColor={C.textMute}
            value={routeFrom}
            onChangeText={setRouteFrom}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={ms.label}>Станция назначения</Text>
          <TextInput
            style={ms.input}
            placeholder="Напр.: Астана"
            placeholderTextColor={C.textMute}
            value={routeTo}
            onChangeText={setRouteTo}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={ms.label}>Дата от (ГГГГ-ММ-ДД)</Text>
          <TextInput
            style={ms.input}
            placeholder="2025-01-01"
            placeholderTextColor={C.textMute}
            value={dateFrom}
            onChangeText={setDateFrom}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <Text style={ms.label}>Дата до (ГГГГ-ММ-ДД)</Text>
          <TextInput
            style={ms.input}
            placeholder="2025-12-31"
            placeholderTextColor={C.textMute}
            value={dateTo}
            onChangeText={setDateTo}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <Text style={ms.label}>Тип поездки</Text>
          <View style={ms.chipWrap}>
            <TouchableOpacity
              style={[ms.chip, tripType === null && ms.chipActive]}
              onPress={() => setTripType(null)}
              activeOpacity={0.75}
            >
              <Text style={[ms.chipText, tripType === null && ms.chipTextActive]}>Все</Text>
            </TouchableOpacity>
            {TRIP_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[ms.chip, tripType === t && ms.chipActive]}
                onPress={() => setTripType(tripType === t ? null : t)}
                activeOpacity={0.75}
              >
                <Text style={[ms.chipText, tripType === t && ms.chipTextActive]}>
                  {TripTypeLabelMap[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={ms.actions}>
            <TouchableOpacity style={ms.resetBtn} onPress={handleReset} activeOpacity={0.75}>
              <Text style={ms.resetBtnText}>Сбросить</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ms.applyBtn} onPress={handleApply} activeOpacity={0.75}>
              <Text style={ms.applyBtnText}>Применить</Text>
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

  // ── Filter state ────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<PeriodFilter>('MONTH');
  const [search, setSearch] = useState('');
  const [tripTypeFilter, setTripTypeFilter] = useState<TripType | null>(null);
  const [locoFilter, setLocoFilter] = useState<string | null>(null);
  const [unsyncedOnly, setUnsyncedOnly] = useState(false);
  const [multiSectionOnly, setMultiSectionOnly] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Modal filter state
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

    // Period
    const bounds = getPeriodBounds(period);
    if (bounds) result = result.filter((t) => t.date >= bounds.from && t.date <= bounds.to);

    // Modal date range (overrides period for exact range)
    if (modalDateFrom) result = result.filter((t) => t.date >= modalDateFrom);
    if (modalDateTo) result = result.filter((t) => t.date <= modalDateTo);

    // Text search — route stations, loco, train number, notes
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

    // Modal station filters
    if (modalRouteFrom) {
      const rf = modalRouteFrom.trim().toLowerCase();
      result = result.filter((t) => t.routeFrom.toLowerCase().includes(rf));
    }
    if (modalRouteTo) {
      const rt = modalRouteTo.trim().toLowerCase();
      result = result.filter((t) => t.routeTo.toLowerCase().includes(rt));
    }

    // Trip type (chips row or modal)
    const effectiveTripType = modalTripType ?? tripTypeFilter;
    if (effectiveTripType) result = result.filter((t) => t.tripType === effectiveTripType);

    // Locomotive model
    if (locoFilter) result = result.filter((t) => t.locoModel === locoFilter);

    // Unsynced only
    if (unsyncedOnly) result = result.filter((t) => !t.syncedAt);

    // Multi-section only (sectionCount > 1)
    if (multiSectionOnly) result = result.filter((t) => (t.sectionCount ?? 1) > 1);

    return result;
  }, [trips, period, search, tripTypeFilter, locoFilter, unsyncedOnly, multiSectionOnly,
    modalRouteFrom, modalRouteTo, modalDateFrom, modalDateTo, modalTripType]);

  const totalMinutes = useMemo(
    () => filtered.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0),
    [filtered],
  );

  // Unique loco models across ALL trips (not filtered) — used to decide whether to show the chip row
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
    const periodLabel = PERIOD_LABELS.find((p) => p.value === period)?.label.toLowerCase() ?? 'все';
    try {
      await exportToCSV(filtered, periodLabel);
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать файл экспорта');
    } finally {
      setExporting(false);
    }
  }

  function handleDeleteItem(item: LocalTrip) {
    Alert.alert(
      'Удалить поездку?',
      'Это действие нельзя отменить.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => deleteTrip(item.id),
        },
      ],
    );
  }

  // ── Render item ─────────────────────────────────────────────────────────────

  function renderItem({ item }: { item: LocalTrip }) {
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
          <Text style={s.chip}>{TripTypeLabelMap[item.tripType]}</Text>
          <View style={s.cardFooterRight}>
            {elec !== null && (
              <Text style={s.elecText}>⚡ {elec.toFixed(0)} кВт·ч</Text>
            )}
            <Text style={s.duration}>{formatDuration(item.durationMinutes ?? 0)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ── Empty text ──────────────────────────────────────────────────────────────

  const emptyText = useMemo(() => {
    if (search.trim()) return `Нет поездок по запросу «${search.trim()}»`;
    if (hasActiveFilters) return 'Нет поездок по выбранным фильтрам';
    if (period === 'ALL') return 'Поездок нет. Добавьте первую!';
    return 'Нет поездок за выбранный период';
  }, [search, hasActiveFilters, period]);

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <View style={s.screen}>

      {/* Header row */}
      <View style={s.topRow}>
        <Text style={s.header}>История поездок</Text>
        <View style={s.topRowActions}>
          <TouchableOpacity
            style={[s.filterBtn, hasModalFilters && s.filterBtnActive]}
            onPress={() => setFilterModalVisible(true)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterBtnText, hasModalFilters && s.filterBtnTextActive]}>
              {hasModalFilters ? 'Фильтры ●' : 'Фильтры'}
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
          placeholder="Поиск по маршруту, локомотиву, заметкам..."
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
            Все типы
          </Text>
        </TouchableOpacity>
        {TRIP_TYPES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.filterChip, tripTypeFilter === t && s.filterChipActive]}
            onPress={() => setTripTypeFilter(tripTypeFilter === t ? null : t)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterChipText, tripTypeFilter === t && s.filterChipTextActive]}>
              {TripTypeLabelMap[t]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Locomotive model chips — only when 2+ distinct models recorded */}
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
              Все лок.
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
            Не синхр.
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleChip, multiSectionOnly && s.toggleChipActive]}
          onPress={() => setMultiSectionOnly((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={[s.toggleChipText, multiSectionOnly && s.toggleChipTextActive]}>
            Много секций
          </Text>
        </TouchableOpacity>
        {hasActiveFilters && (
          <TouchableOpacity style={s.clearBtn} onPress={clearFilters} activeOpacity={0.75}>
            <Text style={s.clearBtnText}>Сбросить</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Summary row */}
      {filtered.length > 0 && (
        <View style={s.summary}>
          <Text style={s.summaryText}>
            {filtered.length} {pluralTrips(filtered.length)}
          </Text>
          <Text style={s.summaryDot}>·</Text>
          <Text style={s.summaryText}>{formatDuration(totalMinutes)}</Text>
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pluralTrips(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'поездка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'поездки';
  return 'поездок';
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

  // Search
  searchRow: { marginBottom: 10 },
  searchInput: {
    backgroundColor: C.card, color: C.text, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    borderWidth: 1, borderColor: C.line,
  },

  // Chip rows (scrollable)
  chipScrollView: { flexGrow: 0, marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
  },
  filterChipActive: { backgroundColor: C.blue, borderColor: C.blue },
  filterChipText: { color: C.textMute, fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },

  // Toggle chips + clear
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

  // Summary row
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10, paddingHorizontal: 2,
  },
  summaryText: { color: C.textDim, fontSize: 13 },
  summaryDot: { color: C.line, fontSize: 13 },

  // Cards
  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 10 },
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
  duration: { color: C.textDim, fontSize: 13 },
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
