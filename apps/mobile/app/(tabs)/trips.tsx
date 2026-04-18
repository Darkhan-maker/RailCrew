import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useTripsStore } from '@/store/trips.store';
import { TripTypeLabelMap } from '@railcrew/contracts';
import { LocalTrip } from '@/services/storage.service';
import { formatDateRu, formatDuration } from '@/utils/date';

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

// ─── CSV export ─────────────────────────────────────────────────────────────

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

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function TripsScreen() {
  const { trips, isLoading, loadLocal, syncPending, deleteTrip } = useTripsStore();
  const [period, setPeriod] = useState<PeriodFilter>('MONTH');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadLocal();
    syncPending().catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const bounds = getPeriodBounds(period);
    if (!bounds) return trips;
    return trips.filter((t) => t.date >= bounds.from && t.date <= bounds.to);
  }, [trips, period]);

  const totalMinutes = useMemo(
    () => filtered.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0),
    [filtered],
  );

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

  return (
    <View style={s.screen}>
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

      {/* Фильтры периода */}
      <View style={s.filterRow}>
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
      </View>

      {/* Итоговая строка */}
      {filtered.length > 0 && (
        <View style={s.summary}>
          <Text style={s.summaryText}>
            {filtered.length} {pluralTrips(filtered.length)}
          </Text>
          <Text style={s.summaryDot}>·</Text>
          <Text style={s.summaryText}>{formatDuration(totalMinutes)}</Text>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.localId ?? t.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <Text style={s.empty}>
              {period === 'ALL'
                ? 'Поездок нет. Добавьте первую!'
                : 'Нет поездок за выбранный период'}
            </Text>
          }
        />
      )}
    </View>
  );
}

function pluralTrips(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'поездка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'поездки';
  return 'поездок';
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a', padding: 16 },

  topRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 48, marginBottom: 12,
  },
  header: { color: '#f1f5f9', fontSize: 24, fontWeight: 'bold' },
  exportBtn: {
    borderWidth: 1, borderColor: '#334155', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 44, alignItems: 'center',
  },
  exportBtnText: { color: '#64748b', fontSize: 13, fontWeight: '600' },

  // Фильтры
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  filterChipActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  filterChipText: { color: '#64748b', fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },

  // Итоги
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 12, paddingHorizontal: 2,
  },
  summaryText: { color: '#94a3b8', fontSize: 13 },
  summaryDot: { color: '#334155', fontSize: 13 },

  // Карточка
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
