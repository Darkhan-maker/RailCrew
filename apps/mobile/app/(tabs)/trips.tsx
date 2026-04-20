import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useTripsStore } from '@/store/trips.store';
import { TripType, TripTypeLabelMap } from '@railcrew/contracts';
import { LocalTrip } from '@/services/storage.service';
import { formatDateRu, formatDuration } from '@/utils/date';

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

  const hasActiveFilters =
    period !== 'MONTH' || search !== '' || tripTypeFilter !== null ||
    locoFilter !== null || unsyncedOnly || multiSectionOnly;

  function clearFilters() {
    setSearch('');
    setTripTypeFilter(null);
    setLocoFilter(null);
    setUnsyncedOnly(false);
    setMultiSectionOnly(false);
    setPeriod('MONTH');
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

    // Trip type
    if (tripTypeFilter) result = result.filter((t) => t.tripType === tripTypeFilter);

    // Locomotive model
    if (locoFilter) result = result.filter((t) => t.locoModel === locoFilter);

    // Unsynced only
    if (unsyncedOnly) result = result.filter((t) => !t.syncedAt);

    // Multi-section only (sectionCount > 1)
    if (multiSectionOnly) result = result.filter((t) => (t.sectionCount ?? 1) > 1);

    return result;
  }, [trips, period, search, tripTypeFilter, locoFilter, unsyncedOnly, multiSectionOnly]);

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
        <TouchableOpacity
          style={[s.exportBtn, exporting && { opacity: 0.5 }]}
          onPress={handleExport}
          disabled={exporting}
          activeOpacity={0.75}
        >
          {exporting
            ? <ActivityIndicator color="#3b82f6" size="small" />
            : <Text style={s.exportBtnText}>CSV</Text>}
        </TouchableOpacity>
      </View>

      {/* Search input */}
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder="Поиск по маршруту, локомотиву, заметкам..."
          placeholderTextColor="#475569"
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
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
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
  screen: { flex: 1, backgroundColor: '#0f172a', padding: 16 },

  topRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 48, marginBottom: 10,
  },
  header: { color: '#f1f5f9', fontSize: 24, fontWeight: 'bold' },
  exportBtn: {
    borderWidth: 1, borderColor: '#334155', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 44, alignItems: 'center',
  },
  exportBtnText: { color: '#64748b', fontSize: 13, fontWeight: '600' },

  // Search
  searchRow: { marginBottom: 10 },
  searchInput: {
    backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    borderWidth: 1, borderColor: '#334155',
  },

  // Chip rows (scrollable)
  chipScrollView: { flexGrow: 0, marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  filterChipActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  filterChipText: { color: '#64748b', fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },

  // Toggle chips + clear
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' },
  toggleChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  toggleChipActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  toggleChipText: { color: '#64748b', fontSize: 12 },
  toggleChipTextActive: { color: '#0f172a', fontWeight: '600' },
  clearBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#ef4444',
  },
  clearBtnText: { color: '#ef4444', fontSize: 12 },

  // Summary row
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10, paddingHorizontal: 2,
  },
  summaryText: { color: '#94a3b8', fontSize: 13 },
  summaryDot: { color: '#334155', fontSize: 13 },

  // Cards
  card: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 10 },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: 8,
  },
  route: { color: '#f1f5f9', fontSize: 16, fontWeight: '600', flex: 1 },
  unsyncedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f59e0b', flexShrink: 0 },
  meta: { color: '#64748b', fontSize: 13, marginTop: 4 },
  metaExtra: { color: '#475569', fontSize: 12, marginTop: 3 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  cardFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: {
    backgroundColor: '#0f172a', color: '#3b82f6', fontSize: 12,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  elecText: { color: '#34d399', fontSize: 12 },
  duration: { color: '#94a3b8', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 60, fontSize: 16 },
});
