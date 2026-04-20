import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { useTripsStore } from '@/store/trips.store';
import { useAuthStore } from '@/store/auth.store';
import {
  localSalaryStorage, LocalSalaryRule,
  localSettingsStorage, LocalSettings,
  LocalTrip,
} from '@/services/storage.service';
import { TripTypeLabelMap } from '@railcrew/contracts';
import { formatDuration } from '@/utils/date';

type PeriodFilter = 'DAY' | 'WEEK' | 'MONTH';

const PERIODS: { label: string; value: PeriodFilter }[] = [
  { label: 'День', value: 'DAY' },
  { label: 'Неделя', value: 'WEEK' },
  { label: 'Месяц', value: 'MONTH' },
];

// Design tokens
const C = {
  bg: '#0B0F14',
  card: '#1A2230',
  blue: '#4D8DFF',
  amber: '#F5B301',
  green: '#3BD48A',
  purple: '#7B61FF',
  textPrimary: '#F0F4FF',
  textSub: '#94A3C0',
  textMuted: '#6B7A99',
  divider: '#1F2836',
};

const TYPE_COLORS: Record<string, string> = {
  FREIGHT: '#4D8DFF',
  PASSENGER: '#3BD48A',
  SHUNTING: '#F5B301',
  DEAD_RUN: '#6B7A99',
};

function getPeriodBounds(period: PeriodFilter): { from: string; to: string } {
  const now = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (period) {
    case 'DAY': return { from: fmt(now), to: fmt(now) };
    case 'WEEK': return {
      from: fmt(startOfWeek(now, { weekStartsOn: 1 })),
      to: fmt(endOfWeek(now, { weekStartsOn: 1 })),
    };
    case 'MONTH': return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
  }
}

function getPeriodLabel(period: PeriodFilter): string {
  switch (period) {
    case 'DAY': return 'Сегодня';
    case 'WEEK': return 'Неделя';
    case 'MONTH': return 'Месяц';
  }
}

function calcDuration(sDate: string, sTime: string, eDate: string, eTime: string): number | null {
  const start = new Date(`${sDate}T${sTime}:00`);
  const end = new Date(`${eDate}T${eTime}:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  return diff > 0 ? diff : null;
}

function parseNightMinutesFromNotes(notes: string | null | undefined): number {
  if (!notes) return 0;
  const match = notes.match(/Ночных:\s*(\d+)\s*ч(?:\s*(\d+)\s*мин)?/);
  if (!match) return 0;
  return (parseInt(match[1], 10) || 0) * 60 + (parseInt(match[2], 10) || 0);
}

function pluralTrips(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'поездка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'поездки';
  return 'поездок';
}

function calcSalary(
  rule: LocalSalaryRule,
  totalMinutes: number,
  nightMinutes: number,
  tripCount: number,
  monthlyNorm: number,
) {
  const totalHours = totalMinutes / 60;
  const nightHours = nightMinutes / 60;
  const threshold = rule.monthlyHoursThreshold || monthlyNorm;
  const overtimeHours = Math.max(0, totalHours - threshold);
  const normalHours = totalHours - overtimeHours;
  const regularHours = Math.max(0, normalHours - nightHours);

  const basePay = Math.max(0, Math.round(regularHours * rule.ratePerHour));
  const nightPay = Math.round(nightHours * rule.ratePerHour * (rule.nightCoefficient || 1.4));
  const overtimePay = Math.round(overtimeHours * rule.ratePerHour * (rule.overtimeCoefficient || 1.5));
  const bonusPay = Math.round(tripCount * rule.tripBonus);
  const total = basePay + nightPay + overtimePay + bonusPay;

  return { basePay, nightPay, overtimePay, bonusPay, total, nightHours, overtimeHours, regularHours };
}

export default function DashboardScreen() {
  const { trips, loadLocal } = useTripsStore();
  const { profile } = useAuthStore();
  const [period, setPeriod] = useState<PeriodFilter>('MONTH');
  const [salaryRule, setSalaryRule] = useState<LocalSalaryRule | null>(null);
  const [settings, setSettings] = useState<LocalSettings | null>(null);

  useEffect(() => {
    loadLocal();
    localSalaryStorage.get().then(setSalaryRule);
    localSettingsStorage.get().then(setSettings);
  }, []);

  const filtered = useMemo(() => {
    const { from, to } = getPeriodBounds(period);
    return trips.filter((t) => t.date >= from && t.date <= to);
  }, [trips, period]);

  const totalMinutes = useMemo(
    () => filtered.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0),
    [filtered],
  );
  const totalHours = Math.floor(totalMinutes / 60);

  const totalNightMinutes = useMemo(
    () => filtered.reduce((sum, t) => {
      const mins = t.nightMinutes ?? parseNightMinutesFromNotes(t.notes);
      return sum + mins;
    }, 0),
    [filtered],
  );

  const salary = useMemo(() => {
    if (!salaryRule || salaryRule.ratePerHour === 0) return null;
    return calcSalary(salaryRule, totalMinutes, totalNightMinutes, filtered.length, settings?.monthlyHoursNorm ?? 176);
  }, [salaryRule, totalMinutes, totalNightMinutes, filtered.length, settings?.monthlyHoursNorm]);

  const normPct = useMemo(() => {
    if (!settings || settings.monthlyHoursNorm <= 0 || period !== 'MONTH') return null;
    return totalHours / settings.monthlyHoursNorm;
  }, [settings, totalHours, period]);

  const cycleStats = useMemo(() => {
    let totalCycleMin = 0, cycleCount = 0;
    for (const t of filtered) {
      if (t.appearanceDate && t.appearanceTime && t.handoverDate && t.handoverTime) {
        const c = calcDuration(t.appearanceDate, t.appearanceTime, t.handoverDate, t.handoverTime);
        if (c !== null) { totalCycleMin += c; cycleCount++; }
      }
    }
    return { totalCycleMin, cycleCount };
  }, [filtered]);

  const elecStats = useMemo(() => {
    let total = 0, count = 0;
    for (const t of filtered) {
      if (t.sectionMeters && t.sectionMeters.length > 0) {
        let tripTotal = 0, allValid = true;
        for (const sm of t.sectionMeters) {
          if (sm.start !== undefined && sm.end !== undefined && sm.end >= sm.start) tripTotal += sm.end - sm.start;
          else allValid = false;
        }
        if (allValid && tripTotal > 0) { total += tripTotal; count++; }
      } else if (t.meterStart !== undefined && t.meterEnd !== undefined && t.meterEnd >= t.meterStart) {
        total += t.meterEnd - t.meterStart; count++;
      }
    }
    return count > 0 ? { total, count } : null;
  }, [filtered]);

  const locoStats = useMemo(() => {
    const map = new Map<string, { label: string; count: number; totalMin: number }>();
    for (const t of filtered) {
      if (!t.locoModel && !t.locoNumber) continue;
      const key = [t.locoModel ?? '', t.locoNumber ? `№${t.locoNumber}` : ''].filter(Boolean).join(' ');
      const ex = map.get(key);
      if (ex) { ex.count++; ex.totalMin += t.durationMinutes ?? 0; }
      else map.set(key, { label: key, count: 1, totalMin: t.durationMinutes ?? 0 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const routeStats = useMemo(() => {
    const map = new Map<string, { routeFrom: string; routeTo: string; count: number; totalMinutes: number }>();
    for (const t of filtered) {
      const key = `${t.routeFrom}__${t.routeTo}`;
      const ex = map.get(key);
      if (ex) { ex.count++; ex.totalMinutes += t.durationMinutes ?? 0; }
      else map.set(key, { routeFrom: t.routeFrom, routeTo: t.routeTo, count: 1, totalMinutes: t.durationMinutes ?? 0 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const typeStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) map.set(t.tripType, (map.get(t.tripType) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const greeting = profile?.firstName ? `Привет, ${profile.firstName}` : 'Сводка';

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 100 }}>
      <Text style={s.greeting}>{greeting}</Text>

      {/* Period tabs */}
      <View style={s.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[s.periodBtn, period === p.value && s.periodBtnActive]}
            onPress={() => setPeriod(p.value)}
            activeOpacity={0.75}
          >
            <Text style={[s.periodBtnText, period === p.value && s.periodBtnTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Hero salary card */}
      {salary && salary.total > 0 ? (
        <HeroSalaryCard salary={salary} periodLabel={getPeriodLabel(period)} />
      ) : (
        <View style={s.card}>
          <Text style={s.cardLabel}>Зарплата · {getPeriodLabel(period)}</Text>
          <Text style={s.placeholder}>
            {!salaryRule || salaryRule.ratePerHour === 0
              ? 'Задайте ставку за час в разделе «Настройки»'
              : 'Нет поездок — заработок не рассчитан'}
          </Text>
        </View>
      )}

      {/* Norm ring + trips tile row */}
      <View style={s.tileRow}>
        {normPct !== null ? (
          <NormTile pct={normPct} hoursWorked={totalHours} hoursNorm={settings!.monthlyHoursNorm} />
        ) : (
          <StatTile label="Часов" value={String(totalHours)} />
        )}
        <StatTile label="Поездок" value={String(filtered.length)} />
      </View>

      {filtered.length === 0 ? (
        <Text style={s.empty}>Нет поездок за выбранный период</Text>
      ) : (
        <>
          {/* Salary breakdown */}
          {salary && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Разбивка зарплаты</Text>
              <BreakdownRow color={C.blue} label={`База (${Math.round(salary.regularHours)} ч)`} amount={salary.basePay} />
              {salary.nightPay > 0 && (
                <BreakdownRow color={C.purple} label={`Ночные (${Math.round(salary.nightHours)} ч)`} amount={salary.nightPay} />
              )}
              {salary.overtimePay > 0 && (
                <BreakdownRow color={C.amber} label={`Сверхурочные (${Math.round(salary.overtimeHours)} ч)`} amount={salary.overtimePay} />
              )}
              {salary.bonusPay > 0 && (
                <BreakdownRow color={C.green} label="Бонусы за поездки" amount={salary.bonusPay} />
              )}
              <View style={s.divider} />
              <BreakdownRow color={C.blue} label="Итого ≈" amount={salary.total} highlight />
            </View>
          )}

          {/* Recent trips */}
          <View style={s.card}>
            <Text style={s.cardLabel}>Последние поездки</Text>
            {filtered.slice(0, 3).map((t, i) => (
              <TripRow
                key={t.id ?? t.localId ?? i}
                trip={t}
                last={i === Math.min(filtered.length, 3) - 1}
              />
            ))}
            {filtered.length > 3 && (
              <Text style={s.moreText}>ещё {filtered.length - 3} {pluralTrips(filtered.length - 3)}</Text>
            )}
          </View>

          {/* Night hours */}
          {settings?.trackNightHours && totalNightMinutes > 0 && (
            <View style={[s.card, s.accentLeft, { borderLeftColor: C.purple }]}>
              <Text style={s.cardLabel}>Ночных часов</Text>
              <Text style={[s.monoLarge, { color: C.purple }]}>{formatDuration(totalNightMinutes)}</Text>
            </View>
          )}

          {/* Work cycle */}
          {cycleStats.cycleCount > 0 && (
            <View style={s.card}>
              <Text style={s.cardLabel}>
                Рабочий цикл · {cycleStats.cycleCount} {pluralTrips(cycleStats.cycleCount)}
              </Text>
              <View style={s.metricRow}>
                <Text style={s.metricLabel}>Всего (явка → сдача)</Text>
                <Text style={s.metricValue}>{formatDuration(cycleStats.totalCycleMin)}</Text>
              </View>
              {cycleStats.cycleCount > 1 && (
                <View style={s.metricRow}>
                  <Text style={s.metricLabel}>Средний цикл</Text>
                  <Text style={[s.metricValue, { color: C.textMuted }]}>
                    {formatDuration(Math.round(cycleStats.totalCycleMin / cycleStats.cycleCount))}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Electricity */}
          {elecStats !== null && (
            <View style={[s.card, s.accentLeft, { borderLeftColor: C.green }]}>
              <Text style={s.cardLabel}>Электроэнергия</Text>
              <View style={s.metricRow}>
                <Text style={s.metricLabel}>Расход за период</Text>
                <Text style={[s.metricValue, { color: C.green }]}>{elecStats.total.toFixed(0)} кВт·ч</Text>
              </View>
              {elecStats.count > 1 && (
                <View style={s.metricRow}>
                  <Text style={s.metricLabel}>Среднее за поездку</Text>
                  <Text style={[s.metricValue, { color: C.textMuted }]}>
                    {Math.round(elecStats.total / elecStats.count)} кВт·ч
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Trip types */}
          {typeStats.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardLabel}>По типам</Text>
              {typeStats.map(([type, count]) => (
                <View key={type} style={s.metricRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[s.dot, { backgroundColor: TYPE_COLORS[type] ?? C.textMuted }]} />
                    <Text style={s.metricLabel}>
                      {TripTypeLabelMap[type as keyof typeof TripTypeLabelMap]}
                    </Text>
                  </View>
                  <Text style={s.metricValue}>{count}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Locos */}
          {locoStats.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Локомотивы</Text>
              {locoStats.map((l, i) => (
                <View key={i} style={s.metricRow}>
                  <Text style={s.metricLabel} numberOfLines={1}>{l.label}</Text>
                  <Text style={s.metricValue}>
                    {l.count} {pluralTrips(l.count)} · {formatDuration(l.totalMin)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Routes */}
          {routeStats.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Маршруты</Text>
              {routeStats.map((r, i) => (
                <View key={i} style={{ marginBottom: 10 }}>
                  <Text style={s.metricValue} numberOfLines={1}>{r.routeFrom} — {r.routeTo}</Text>
                  <Text style={[s.metricLabel, { marginTop: 2 }]}>
                    {r.count} {pluralTrips(r.count)} · {formatDuration(r.totalMinutes)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HeroSalaryCard({
  salary,
  periodLabel,
}: {
  salary: ReturnType<typeof calcSalary>;
  periodLabel: string;
}) {
  const { basePay, nightPay, overtimePay, bonusPay, total } = salary;
  const safeTotal = Math.max(total, 1);

  return (
    <View style={s.heroCard}>
      <Text style={s.cardLabel}>Зарплата · {periodLabel}</Text>
      <Text style={s.heroAmount}>{total.toLocaleString()} ₸</Text>

      {/* StackedBar */}
      <View style={s.stackedBar}>
        {basePay > 0 && (
          <View style={{ flex: basePay / safeTotal, backgroundColor: C.blue }} />
        )}
        {nightPay > 0 && (
          <View style={{ flex: nightPay / safeTotal, backgroundColor: C.purple }} />
        )}
        {overtimePay > 0 && (
          <View style={{ flex: overtimePay / safeTotal, backgroundColor: C.amber }} />
        )}
        {bonusPay > 0 && (
          <View style={{ flex: bonusPay / safeTotal, backgroundColor: C.green }} />
        )}
      </View>

      {/* Legend */}
      <View style={s.legendRow}>
        {basePay > 0 && <LegendDot color={C.blue} label="База" />}
        {nightPay > 0 && <LegendDot color={C.purple} label="Ночные" />}
        {overtimePay > 0 && <LegendDot color={C.amber} label="Сверхур." />}
        {bonusPay > 0 && <LegendDot color={C.green} label="Бонусы" />}
      </View>
    </View>
  );
}

function NormTile({ pct, hoursWorked, hoursNorm }: {
  pct: number;
  hoursWorked: number;
  hoursNorm: number;
}) {
  const color = pct >= 1 ? C.amber : C.blue;
  return (
    <View style={[s.tile, { alignItems: 'center' }]}>
      <View style={[s.normRing, { borderColor: color }]}>
        <Text style={[s.normPct, { color }]}>{Math.round(pct * 100)}%</Text>
      </View>
      <Text style={s.tileLabel}>Норма</Text>
      <Text style={s.tileSub}>{hoursWorked} / {hoursNorm} ч</Text>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

function BreakdownRow({ color, label, amount, highlight }: {
  color: string;
  label: string;
  amount: number;
  highlight?: boolean;
}) {
  return (
    <View style={s.breakdownRow}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={[s.breakdownLabel, highlight && { color: C.textPrimary, fontWeight: '600' }]}>
        {label}
      </Text>
      <Text style={[
        s.breakdownAmount,
        highlight && { color: C.blue, fontSize: 16, fontWeight: '700' },
      ]}>
        {amount.toLocaleString()} ₸
      </Text>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={s.legendLabel}>{label}</Text>
    </View>
  );
}

function TripRow({ trip, last }: { trip: LocalTrip; last: boolean }) {
  const color = TYPE_COLORS[trip.tripType] ?? C.textMuted;
  const typeLabel = TripTypeLabelMap[trip.tripType as keyof typeof TripTypeLabelMap] ?? trip.tripType;

  return (
    <View style={[s.tripRow, !last && { borderBottomWidth: 1, borderBottomColor: C.divider }]}>
      <View style={s.tripTop}>
        <Text style={s.tripRoute} numberOfLines={1}>
          {trip.routeFrom} → {trip.routeTo}
        </Text>
        <View style={[s.typeChip, { backgroundColor: color + '26' }]}>
          <Text style={[s.typeChipText, { color }]}>{typeLabel}</Text>
        </View>
      </View>
      <View style={s.tripMeta}>
        <Text style={s.tripMetaText}>{trip.date}</Text>
        <Text style={[s.tripMetaText, { fontFamily: 'monospace' }]}>
          {formatDuration(trip.durationMinutes ?? 0)}
        </Text>
        {!trip.syncedAt && (
          <Text style={[s.tripMetaText, { color: C.amber }]}>● локально</Text>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, padding: 16 },

  greeting: {
    color: C.textPrimary, fontSize: 22, fontWeight: '700',
    marginTop: 48, marginBottom: 12,
  },

  // Period
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.divider,
  },
  periodBtnActive: { backgroundColor: C.blue, borderColor: C.blue },
  periodBtnText: { color: C.textMuted, fontSize: 14 },
  periodBtnTextActive: { color: '#fff', fontWeight: '600' },

  // Cards
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardLabel: {
    color: C.textMuted, fontSize: 11, fontWeight: '600',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  accentLeft: { borderLeftWidth: 3 },
  divider: { height: 1, backgroundColor: C.divider, marginVertical: 8 },
  placeholder: { color: C.textMuted, fontSize: 14, paddingVertical: 4 },

  // Hero salary card
  heroCard: { backgroundColor: C.card, borderRadius: 16, padding: 20, marginBottom: 12 },
  heroAmount: {
    color: C.textPrimary, fontSize: 38, fontWeight: '700',
    fontFamily: 'monospace', marginBottom: 16,
  },
  stackedBar: {
    height: 6, flexDirection: 'row', borderRadius: 3, overflow: 'hidden', marginBottom: 12,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLabel: { color: C.textSub, fontSize: 12 },

  // Tiles
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tile: {
    flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  tileValue: { color: C.blue, fontSize: 32, fontWeight: '700', fontFamily: 'monospace' },
  tileLabel: { color: C.textMuted, fontSize: 12, marginTop: 6 },
  tileSub: { color: C.textSub, fontSize: 11, marginTop: 2 },

  // Norm ring
  normRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 5,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  normPct: { fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },

  // Breakdown
  breakdownRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  breakdownLabel: { flex: 1, color: C.textMuted, fontSize: 14 },
  breakdownAmount: { color: C.textPrimary, fontSize: 14, fontWeight: '600', fontFamily: 'monospace' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10, flexShrink: 0 },

  // Trip rows
  tripRow: { paddingVertical: 12 },
  tripTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  tripRoute: { color: C.textPrimary, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  typeChip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  typeChipText: { fontSize: 11, fontWeight: '600' },
  tripMeta: { flexDirection: 'row', gap: 12 },
  tripMetaText: { color: C.textMuted, fontSize: 12 },
  moreText: { color: C.textMuted, fontSize: 12, textAlign: 'center', marginTop: 6 },

  // Misc
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  metricLabel: { color: C.textMuted, fontSize: 14, flex: 1, paddingRight: 8 },
  metricValue: { color: C.textPrimary, fontSize: 14, fontWeight: '600' },
  monoLarge: { fontSize: 24, fontWeight: '700', fontFamily: 'monospace', marginTop: 4 },

  empty: { color: C.textMuted, textAlign: 'center', marginTop: 40, fontSize: 15 },
});
