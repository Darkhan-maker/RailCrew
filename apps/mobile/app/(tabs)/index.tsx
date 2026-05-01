import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTripsStore } from '@/store/trips.store';
import { useAuthStore } from '@/store/auth.store';
import {
  localSalaryStorage, LocalSalaryRule,
  localSettingsStorage, LocalSettings,
  LocalTrip,
} from '@/services/storage.service';
import { TripType } from '@railcrew/contracts';
import { formatDuration } from '@/utils/date';
import { filterTripsByPeriod, getPeriodBounds } from '@/utils/period';
import { exportApi } from '@/services/api.service';
import { useLang, pluralTrips, fmtDur } from '@/i18n';
import { useTheme, Theme } from '@/theme';

type PeriodFilter = 'DAY' | 'WEEK' | 'MONTH';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTH_SHORT_KK = ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'];

function formatDateShort(isoDate: string, lang: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const months = lang === 'kk' ? MONTH_SHORT_KK : MONTH_SHORT;
  return `${d} ${months[m - 1]} ${y}`;
}

function typeColor(type: string, theme: Theme): string {
  const map: Record<string, string> = {
    FREIGHT: theme.primary,
    PASSENGER: theme.success,
    SHUNTING: theme.warning,
    DEAD_RUN: theme.textMute,
  };
  return map[type] ?? theme.textMute;
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

function calcSalary(
  rule: LocalSalaryRule,
  totalMinutes: number,
  nightMinutes: number,
  holidayMinutes: number,
  tripCount: number,
  monthlyNorm: number,
) {
  const rate = rule.ratePerHour;
  const totalHours = totalMinutes / 60;
  const nightHours = nightMinutes / 60;
  const holidayHours = holidayMinutes / 60;
  const threshold = rule.monthlyHoursThreshold || monthlyNorm;
  const overtimeHours = Math.max(0, totalHours - threshold);
  const normalHours = totalHours - overtimeHours;
  const regularHours = Math.max(0, normalHours - nightHours - holidayHours);

  // Base components
  const tariffPay = Math.max(0, Math.round(regularHours * rate));
  const nightPay = Math.round(nightHours * rate * (rule.nightCoefficient || 1.4));
  const holidayPay = Math.round(holidayHours * rate * (rule.holidayCoefficient || 2));
  const overtimePay = Math.round(overtimeHours * rate * (rule.overtimeCoefficient || 1.5));
  const tripBonusPay = Math.round(
    tripCount * (rule.tripBonus || 0) + totalHours * (rule.tripBonusPerHour || 0),
  );

  // Percentage addons (applied to tariffPay base)
  const harmfulnessPay = Math.round(tariffPay * (rule.harmfulnessPercent || 0) / 100);
  const classPay = Math.round(tariffPay * (rule.classPercent || 0) / 100);
  const zonalPay = Math.round(tariffPay * (rule.zonalPercent || 0) / 100);

  // Subtotal before regional coefficient
  const subtotalBeforeRK =
    tariffPay + nightPay + holidayPay + overtimePay + tripBonusPay +
    harmfulnessPay + classPay + zonalPay;

  // Apply regional coefficient
  const rk = rule.regionalCoefficient || 1;
  const gross = Math.round(subtotalBeforeRK * rk);

  // Deductions
  const unionDeduction = Math.round(gross * (rule.unionPercent || 0) / 100);
  const taxDeduction = Math.round((gross - unionDeduction) * (rule.taxPercent || 13) / 100);
  const netPay = gross - unionDeduction - taxDeduction;

  // Legacy total for hero card (gross)
  const total = gross;
  // Legacy aliases for existing breakdown display
  const basePay = tariffPay;
  const bonusPay = tripBonusPay;

  return {
    tariffPay, nightPay, holidayPay, overtimePay, tripBonusPay,
    harmfulnessPay, classPay, zonalPay,
    subtotalBeforeRK, gross, unionDeduction, taxDeduction, netPay,
    nightHours, holidayHours, overtimeHours, regularHours,
    // legacy aliases
    basePay, bonusPay, total,
  };
}

export default function DashboardScreen() {
  const { trips, loadLocal, syncFromServer } = useTripsStore();
  const { profile } = useAuthStore();
  const { t, lang } = useLang();
  const { theme } = useTheme();
  const [period, setPeriod] = useState<PeriodFilter>('MONTH');
  const [salaryRule, setSalaryRule] = useState<LocalSalaryRule | null>(null);
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [exporting, setExporting] = useState(false);

  const PERIODS: { label: string; value: PeriodFilter }[] = [
    { label: t.dashboard_day, value: 'DAY' },
    { label: t.dashboard_week, value: 'WEEK' },
    { label: t.dashboard_month, value: 'MONTH' },
  ];

  function getPeriodLabel(p: PeriodFilter): string {
    switch (p) {
      case 'DAY': return t.dashboard_today;
      case 'WEEK': return t.dashboard_week;
      case 'MONTH': return t.dashboard_month;
    }
  }

  useEffect(() => {
    loadLocal();
    syncFromServer().catch(() => {});
    localSalaryStorage.get().then(setSalaryRule);
    localSettingsStorage.get().then(setSettings);
  }, []);

  const filtered = useMemo(
    () => filterTripsByPeriod(trips, period),
    [trips, period],
  );

  const totalMinutes = useMemo(
    () => filtered.reduce((sum, tr) => sum + (tr.durationMinutes ?? 0), 0),
    [filtered],
  );
  const totalHours = Math.floor(totalMinutes / 60);

  const totalNightMinutes = useMemo(
    () => filtered.reduce((sum, tr) => {
      const mins = tr.nightMinutes ?? parseNightMinutesFromNotes(tr.notes);
      return sum + mins;
    }, 0),
    [filtered],
  );

  const totalHolidayMinutes = useMemo(
    () => filtered.reduce((sum, tr) => sum + (tr.holidayMinutes ?? 0), 0),
    [filtered],
  );

  const salary = useMemo(() => {
    if (!salaryRule || salaryRule.ratePerHour === 0) return null;
    return calcSalary(
      salaryRule, totalMinutes, totalNightMinutes, totalHolidayMinutes,
      filtered.length, settings?.monthlyHoursNorm ?? 176,
    );
  }, [salaryRule, totalMinutes, totalNightMinutes, filtered.length, settings?.monthlyHoursNorm]);

  const normPct = useMemo(() => {
    if (!settings || settings.monthlyHoursNorm <= 0 || period !== 'MONTH') return null;
    return totalHours / settings.monthlyHoursNorm;
  }, [settings, totalHours, period]);

  const cycleStats = useMemo(() => {
    let totalCycleMin = 0, cycleCount = 0;
    for (const tr of filtered) {
      if (tr.appearanceDate && tr.appearanceTime && tr.handoverDate && tr.handoverTime) {
        const c = calcDuration(tr.appearanceDate, tr.appearanceTime, tr.handoverDate, tr.handoverTime);
        if (c !== null) { totalCycleMin += c; cycleCount++; }
      }
    }
    return { totalCycleMin, cycleCount };
  }, [filtered]);

  const elecStats = useMemo(() => {
    let total = 0, count = 0;
    for (const tr of filtered) {
      if (tr.sectionMeters && tr.sectionMeters.length > 0) {
        let tripTotal = 0, allValid = true;
        for (const sm of tr.sectionMeters) {
          if (sm.start !== undefined && sm.end !== undefined && sm.end >= sm.start) tripTotal += sm.end - sm.start;
          else allValid = false;
        }
        if (allValid && tripTotal > 0) { total += tripTotal; count++; }
      } else if (tr.meterStart !== undefined && tr.meterEnd !== undefined && tr.meterEnd >= tr.meterStart) {
        total += tr.meterEnd - tr.meterStart; count++;
      }
    }
    return count > 0 ? { total, count } : null;
  }, [filtered]);

  const locoStats = useMemo(() => {
    const map = new Map<string, { label: string; count: number; totalMin: number }>();
    for (const tr of filtered) {
      if (!tr.locoModel && !tr.locoNumber) continue;
      const key = [tr.locoModel ?? '', tr.locoNumber ? `№${tr.locoNumber}` : ''].filter(Boolean).join(' ');
      const ex = map.get(key);
      if (ex) { ex.count++; ex.totalMin += tr.durationMinutes ?? 0; }
      else map.set(key, { label: key, count: 1, totalMin: tr.durationMinutes ?? 0 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const routeStats = useMemo(() => {
    const map = new Map<string, { routeFrom: string; routeTo: string; count: number; totalMinutes: number }>();
    for (const tr of filtered) {
      const key = `${tr.routeFrom}__${tr.routeTo}`;
      const ex = map.get(key);
      if (ex) { ex.count++; ex.totalMinutes += tr.durationMinutes ?? 0; }
      else map.set(key, { routeFrom: tr.routeFrom, routeTo: tr.routeTo, count: 1, totalMinutes: tr.durationMinutes ?? 0 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const typeStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const tr of filtered) map.set(tr.tripType, (map.get(tr.tripType) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const tripTypeLabel = (type: TripType): string => {
    const map: Record<string, string> = {
      FREIGHT: t.tripType_FREIGHT,
      PASSENGER: t.tripType_PASSENGER,
      SHUNTING: t.tripType_SHUNTING,
      DEAD_RUN: t.tripType_DEAD_RUN,
    };
    return map[type] ?? type;
  };

  const greeting = profile?.firstName ? `${t.dashboard_helloPrefix}${profile.firstName}` : t.dashboard_titleFallback;

  const { from: monthFrom, to: monthTo } = getPeriodBounds('MONTH')!;

  function handleExportMonth(fmt: 'pdf' | 'xlsx') {
    Alert.alert(
      t.dashboard_exportTitle,
      `${t.dashboard_exportChoose} (${monthFrom} — ${monthTo})`,
      [
        { text: t.common_cancel, style: 'cancel' },
        {
          text: t.dashboard_download,
          onPress: async () => {
            setExporting(true);
            try {
              if (fmt === 'pdf') {
                const data = await exportApi.downloadPeriodPdf(monthFrom, monthTo);
                const path = `${FileSystem.cacheDirectory}trips-${monthFrom}-${monthTo}.pdf`;
                await FileSystem.writeAsStringAsync(path, Buffer.from(data).toString('base64'), {
                  encoding: FileSystem.EncodingType.Base64,
                });
                await Sharing.shareAsync(path, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
              } else {
                const data = await exportApi.downloadPeriodXlsx(monthFrom, monthTo);
                const path = `${FileSystem.cacheDirectory}trips-${monthFrom}-${monthTo}.xlsx`;
                await FileSystem.writeAsStringAsync(path, Buffer.from(data).toString('base64'), {
                  encoding: FileSystem.EncodingType.Base64,
                });
                await Sharing.shareAsync(path, {
                  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  UTI: 'org.openxmlformats.spreadsheetml.sheet',
                });
              }
            } catch {
              Alert.alert(t.common_error, t.dashboard_exportError);
            } finally {
              setExporting(false);
            }
          },
        },
      ],
    );
  }

  function handleExportPress() {
    Alert.alert(t.dashboard_exportTitle, t.dashboard_exportChoose, [
      { text: t.common_cancel, style: 'cancel' },
      { text: 'PDF', onPress: () => handleExportMonth('pdf') },
      { text: 'Excel', onPress: () => handleExportMonth('xlsx') },
    ]);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg, padding: 16 }}
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      <View style={s.greetingRow}>
        <Text style={[s.greeting, { color: theme.text }]}>{greeting}</Text>
        <TouchableOpacity
          style={[s.exportMonthBtn, { borderColor: theme.primary }]}
          onPress={handleExportPress}
          disabled={exporting}
          activeOpacity={0.75}
        >
          {exporting
            ? <ActivityIndicator color={theme.primary} size="small" />
            : <Text style={[s.exportMonthBtnText, { color: theme.primary }]}>{t.dashboard_exportMonth}</Text>}
        </TouchableOpacity>
      </View>

      {/* Period tabs */}
      <View style={s.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[
              s.periodBtn,
              { backgroundColor: theme.card, borderColor: theme.border },
              period === p.value && { backgroundColor: theme.primary, borderColor: theme.primary },
            ]}
            onPress={() => setPeriod(p.value)}
            activeOpacity={0.75}
          >
            <Text style={[
              s.periodBtnText,
              { color: theme.textMute },
              period === p.value && { color: '#fff', fontWeight: '600' },
            ]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Hero salary card */}
      {salary && salary.netPay > 0 ? (
        <HeroSalaryCard salary={salary} periodLabel={getPeriodLabel(period)} />
      ) : (
        <View style={[s.card, { backgroundColor: theme.card }]}>
          <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_salary} · {getPeriodLabel(period)}</Text>
          <Text style={[s.placeholder, { color: theme.textMute }]}>
            {!salaryRule || salaryRule.ratePerHour === 0
              ? t.dashboard_setRate
              : t.dashboard_noTrips}
          </Text>
        </View>
      )}

      {/* Norm ring + trips tile row */}
      <View style={s.tileRow}>
        {normPct !== null ? (
          <NormTile pct={normPct} hoursWorked={totalHours} hoursNorm={settings!.monthlyHoursNorm} />
        ) : (
          <StatTile label={t.dashboard_hours} value={String(totalHours)} />
        )}
        <StatTile label={t.dashboard_tripsCount} value={String(filtered.length)} />
      </View>

      {filtered.length === 0 ? (
        <Text style={[s.empty, { color: theme.textMute }]}>{t.dashboard_empty}</Text>
      ) : (
        <>
          {/* Детализация зарплаты */}
          {salary && (
            <SalaryDetailCard salary={salary} />
          )}

          {/* Recent trips */}
          <View style={[s.card, { backgroundColor: theme.card }]}>
            <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_recentTrips}</Text>
            {filtered.slice(0, 3).map((tr, i) => (
              <TripRow
                key={tr.id ?? tr.localId ?? i}
                trip={tr}
                last={i === Math.min(filtered.length, 3) - 1}
                tripTypeLabel={tripTypeLabel(tr.tripType as TripType)}
                lang={lang}
              />
            ))}
            {filtered.length > 3 && (
              <Text style={[s.moreText, { color: theme.textMute }]}>
                {lang === 'kk'
                  ? `тағы ${filtered.length - 3} ${pluralTrips(filtered.length - 3, t)}`
                  : `ещё ${filtered.length - 3} ${pluralTrips(filtered.length - 3, t)}`}
              </Text>
            )}
          </View>

          {/* Night hours */}
          {settings?.trackNightHours && totalNightMinutes > 0 && (
            <View style={[s.card, s.accentLeft, { backgroundColor: theme.card, borderLeftColor: '#8B5CF6' }]}>
              <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_nightHours}</Text>
              <Text style={[s.monoLarge, { color: '#8B5CF6' }]}>{formatDuration(totalNightMinutes)}</Text>
            </View>
          )}

          {/* Work cycle */}
          {cycleStats.cycleCount > 0 && (
            <View style={[s.card, { backgroundColor: theme.card }]}>
              <Text style={[s.cardLabel, { color: theme.textMute }]}>
                {t.dashboard_workCycle} · {cycleStats.cycleCount} {pluralTrips(cycleStats.cycleCount, t)}
              </Text>
              <View style={s.metricRow}>
                <Text style={[s.metricLabel, { color: theme.textMute }]}>{t.dashboard_totalCycle}</Text>
                <Text style={[s.metricValue, { color: theme.text }]}>{fmtDur(cycleStats.totalCycleMin, t)}</Text>
              </View>
              {cycleStats.cycleCount > 1 && (
                <View style={s.metricRow}>
                  <Text style={[s.metricLabel, { color: theme.textMute }]}>{t.dashboard_avgCycle}</Text>
                  <Text style={[s.metricValue, { color: theme.textDim }]}>
                    {fmtDur(Math.round(cycleStats.totalCycleMin / cycleStats.cycleCount), t)}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Electricity */}
          {elecStats !== null && (
            <View style={[s.card, s.accentLeft, { backgroundColor: theme.card, borderLeftColor: theme.success }]}>
              <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_electricity}</Text>
              <View style={s.metricRow}>
                <Text style={[s.metricLabel, { color: theme.textMute }]}>{t.dashboard_elecPeriod}</Text>
                <Text style={[s.metricValue, { color: theme.success }]}>{elecStats.total.toFixed(0)} кВт·ч</Text>
              </View>
              {elecStats.count > 1 && (
                <View style={s.metricRow}>
                  <Text style={[s.metricLabel, { color: theme.textMute }]}>{t.dashboard_elecAvg}</Text>
                  <Text style={[s.metricValue, { color: theme.textDim }]}>
                    {Math.round(elecStats.total / elecStats.count)} кВт·ч
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Trip types */}
          {typeStats.length > 0 && (
            <View style={[s.card, { backgroundColor: theme.card }]}>
              <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_byType}</Text>
              {typeStats.map(([type, count]) => (
                <View key={type} style={s.metricRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[s.dot, { backgroundColor: typeColor(type, theme) }]} />
                    <Text style={[s.metricLabel, { color: theme.textMute }]}>{tripTypeLabel(type as TripType)}</Text>
                  </View>
                  <Text style={[s.metricValue, { color: theme.text }]}>{count}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Locos */}
          {locoStats.length > 0 && (
            <View style={[s.card, { backgroundColor: theme.card }]}>
              <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_locos}</Text>
              {locoStats.map((l, i) => (
                <View key={i} style={s.metricRow}>
                  <Text style={[s.metricLabel, { color: theme.textMute }]} numberOfLines={1}>{l.label}</Text>
                  <Text style={[s.metricValue, { color: theme.text }]}>
                    {l.count} {pluralTrips(l.count, t)} · {fmtDur(l.totalMin, t)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Routes */}
          {routeStats.length > 0 && (
            <View style={[s.card, { backgroundColor: theme.card }]}>
              <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_routes}</Text>
              {routeStats.map((r, i) => (
                <View key={i} style={{ marginBottom: 10 }}>
                  <Text style={[s.metricValue, { color: theme.text }]} numberOfLines={1}>{r.routeFrom} — {r.routeTo}</Text>
                  <Text style={[s.metricLabel, { color: theme.textMute, marginTop: 2 }]}>
                    {r.count} {pluralTrips(r.count, t)} · {fmtDur(r.totalMinutes, t)}
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

function SalaryDetailCard({ salary }: { salary: ReturnType<typeof calcSalary> }) {
  const { t } = useLang();
  const { theme } = useTheme();

  const fmt = (n: number) => Math.round(n).toLocaleString() + ' ₸';
  const fmtH = (h: number) => `${Math.round(h * 10) / 10} ${t.hour_abbr}`;

  function DetailRow({
    color, label, sub, amount, deduction, highlight,
  }: {
    color?: string;
    label: string;
    sub?: string;
    amount: number;
    deduction?: boolean;
    highlight?: boolean;
  }) {
    const amountColor = deduction ? theme.danger : highlight ? theme.primary : theme.text;
    const sign = deduction ? '−' : '';
    return (
      <View style={sd.row}>
        {color ? <View style={[sd.dot, { backgroundColor: color }]} /> : <View style={sd.dotEmpty} />}
        <View style={{ flex: 1 }}>
          <Text style={[sd.label, { color: highlight ? theme.text : theme.textDim }, highlight && { fontWeight: '600' }]}>
            {label}
          </Text>
          {sub ? <Text style={[sd.sub, { color: theme.textMute }]}>{sub}</Text> : null}
        </View>
        <Text style={[sd.amount, { color: amountColor }, highlight && { fontSize: 16, fontWeight: '700' }]}>
          {sign}{fmt(Math.abs(amount))}
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: theme.card }]}>
      <Text style={[s.cardLabel, { color: theme.textMute }]}>{t.dashboard_salaryDetail}</Text>

      {/* Начисления */}
      <DetailRow color={theme.primary} label={t.dashboard_tariff}
        sub={fmtH(salary.regularHours)} amount={salary.tariffPay} />
      {salary.nightPay > 0 && (
        <DetailRow color="#8B5CF6" label={t.dashboard_nightAddon}
          sub={fmtH(salary.nightHours)} amount={salary.nightPay} />
      )}
      {salary.holidayPay > 0 && (
        <DetailRow color={theme.warning} label={t.dashboard_holidayAddon}
          sub={fmtH(salary.holidayHours)} amount={salary.holidayPay} />
      )}
      {salary.overtimePay > 0 && (
        <DetailRow color={theme.warning} label={t.dashboard_overtimeAddon}
          sub={fmtH(salary.overtimeHours)} amount={salary.overtimePay} />
      )}
      {salary.tripBonusPay > 0 && (
        <DetailRow color={theme.success} label={t.dashboard_tripBonuses} amount={salary.tripBonusPay} />
      )}
      {salary.harmfulnessPay > 0 && (
        <DetailRow color="#F97316" label={t.dashboard_harmfulness} amount={salary.harmfulnessPay} />
      )}
      {salary.classPay > 0 && (
        <DetailRow color="#06B6D4" label={t.dashboard_classBonus} amount={salary.classPay} />
      )}
      {salary.zonalPay > 0 && (
        <DetailRow color="#84CC16" label={t.dashboard_zonalBonus} amount={salary.zonalPay} />
      )}

      {/* Районный коэффициент */}
      <View style={[sd.divider, { backgroundColor: theme.border }]} />
      <DetailRow label={t.dashboard_regionalCoeff}
        sub={`× ${salary.gross > 0 ? (salary.gross / Math.max(salary.subtotalBeforeRK, 1)).toFixed(2) : '1.00'}`}
        amount={salary.gross - salary.subtotalBeforeRK} />

      {/* Подытог (брутто) */}
      <View style={[sd.divider, { backgroundColor: theme.border }]} />
      <DetailRow label={t.dashboard_subtotal} amount={salary.gross} highlight />

      {/* Вычеты */}
      {salary.unionDeduction > 0 && (
        <DetailRow label={t.dashboard_union} amount={salary.unionDeduction} deduction />
      )}
      {salary.taxDeduction > 0 && (
        <DetailRow label={t.dashboard_ndfl} amount={salary.taxDeduction} deduction />
      )}

      {/* Итого на руки */}
      <View style={[sd.divider, { backgroundColor: theme.border }]} />
      <View style={[sd.netRow, { backgroundColor: theme.primaryDim }]}>
        <Text style={[sd.netLabel, { color: theme.text }]}>{t.dashboard_netPay}</Text>
        <Text style={[sd.netAmount, { color: theme.primary }]}>{fmt(salary.netPay)}</Text>
      </View>
    </View>
  );
}

const sd = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10, flexShrink: 0 },
  dotEmpty: { width: 8, marginRight: 10 },
  label: { fontSize: 14 },
  sub: { fontSize: 11, marginTop: 1 },
  amount: { fontSize: 14, fontWeight: '600', fontFamily: 'monospace', marginLeft: 8 },
  divider: { height: 1, marginVertical: 8 },
  netRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginTop: 4,
  },
  netLabel: { fontSize: 15, fontWeight: '600' },
  netAmount: { fontSize: 22, fontWeight: '700', fontFamily: 'monospace' },
});

function HeroSalaryCard({
  salary,
  periodLabel,
}: {
  salary: ReturnType<typeof calcSalary>;
  periodLabel: string;
}) {
  const { t } = useLang();
  const { theme } = useTheme();
  const { netPay, gross, tariffPay, nightPay, overtimePay, tripBonusPay } = salary;
  const safeGross = Math.max(gross, 1);

  return (
    <View style={[s.heroCard, { backgroundColor: theme.primaryDark, borderTopColor: theme.primary }]}>
      {/* pseudo-gradient overlay */}
      <View style={[StyleSheet.absoluteFill, s.heroGlowLeft, { backgroundColor: theme.primary }]} />
      <View style={[StyleSheet.absoluteFill, s.heroGlowRight, { backgroundColor: theme.primaryDark }]} />

      <Text style={[s.cardLabel, { color: '#ffffff88', zIndex: 1 }]}>{t.dashboard_netPay} · {periodLabel}</Text>
      <Text style={[s.heroAmount, { zIndex: 1 }]}>{netPay.toLocaleString()} ₸</Text>
      <Text style={[s.heroGross, { zIndex: 1 }]}>{t.dashboard_subtotal}: {gross.toLocaleString()} ₸</Text>

      <View style={[s.stackedBar, { zIndex: 1 }]}>
        {tariffPay > 0 && <View style={{ flex: tariffPay / safeGross, backgroundColor: '#ffffff66' }} />}
        {nightPay > 0 && <View style={{ flex: nightPay / safeGross, backgroundColor: '#8B5CF666' }} />}
        {overtimePay > 0 && <View style={{ flex: overtimePay / safeGross, backgroundColor: '#F59E0B99' }} />}
        {tripBonusPay > 0 && <View style={{ flex: tripBonusPay / safeGross, backgroundColor: '#10B98199' }} />}
      </View>

      <View style={[s.legendRow, { zIndex: 1 }]}>
        {tariffPay > 0 && <LegendDot color="#ffffff99" label={t.dashboard_tariff} />}
        {nightPay > 0 && <LegendDot color="#8B5CF6cc" label={t.dashboard_nightAddon} />}
        {overtimePay > 0 && <LegendDot color="#F59E0Bcc" label={t.dashboard_overtimeAddon} />}
        {tripBonusPay > 0 && <LegendDot color="#10B981cc" label={t.dashboard_tripBonuses} />}
      </View>
    </View>
  );
}

function NormTile({ pct, hoursWorked, hoursNorm }: {
  pct: number;
  hoursWorked: number;
  hoursNorm: number;
}) {
  const { t } = useLang();
  const { theme } = useTheme();
  const color = pct >= 1 ? theme.warning : theme.primary;
  return (
    <View style={[s.tile, { alignItems: 'center', backgroundColor: theme.card }]}>
      <View style={[s.normRing, { borderColor: color }]}>
        <Text style={[s.normPct, { color }]}>{Math.round(pct * 100)}%</Text>
      </View>
      <Text style={[s.tileLabel, { color: theme.textMute }]}>{t.dashboard_norm}</Text>
      <Text style={[s.tileSub, { color: theme.textDim }]}>{hoursWorked} / {hoursNorm} {t.hour_abbr}</Text>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[s.tile, { backgroundColor: theme.card }]}>
      <Text style={[s.tileValue, { color: theme.primary }]}>{value}</Text>
      <Text style={[s.tileLabel, { color: theme.textMute }]}>{label}</Text>
    </View>
  );
}

function BreakdownRow({ color, label, amount, highlight }: {
  color: string;
  label: string;
  amount: number;
  highlight?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={s.breakdownRow}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={[s.breakdownLabel, { color: theme.textMute }, highlight && { color: theme.text, fontWeight: '600' }]}>
        {label}
      </Text>
      <Text style={[
        s.breakdownAmount,
        { color: theme.text },
        highlight && { color: theme.primary, fontSize: 16, fontWeight: '700' },
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

function TripRow({ trip, last, tripTypeLabel, lang }: {
  trip: LocalTrip;
  last: boolean;
  tripTypeLabel: string;
  lang: string;
}) {
  const { theme } = useTheme();
  const color = typeColor(trip.tripType, theme);

  return (
    <View style={[s.tripRow, !last && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
      <View style={s.tripTop}>
        <Text style={[s.tripRoute, { color: theme.text }]} numberOfLines={1}>
          {trip.routeFrom} → {trip.routeTo}
        </Text>
        <View style={[s.typeChip, { backgroundColor: color + '26' }]}>
          <Text style={[s.typeChipText, { color }]}>{tripTypeLabel}</Text>
        </View>
      </View>
      <View style={s.tripMeta}>
        <Text style={[s.tripMetaText, { color: theme.textMute }]}>{formatDateShort(trip.date, lang)}</Text>
        <Text style={[s.tripMetaText, { color: theme.textMute, fontFamily: 'monospace' }]}>
          {formatDuration(trip.durationMinutes ?? 0)}
        </Text>
        {!trip.syncedAt && (
          <Text style={[s.tripMetaText, { color: theme.warning }]}>{lang === 'kk' ? '● жергілікті' : '● локально'}</Text>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  greetingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    marginTop: 48, marginBottom: 12,
  },
  greeting: { fontSize: 22, fontWeight: '700', flex: 1 },
  exportMonthBtn: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7, marginLeft: 12,
  },
  exportMonthBtnText: { fontSize: 13, fontWeight: '600' },

  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  periodBtnText: { fontSize: 14 },

  card: { borderRadius: 16, padding: 16, marginBottom: 12 },
  cardLabel: {
    fontSize: 11, fontWeight: '600',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  accentLeft: { borderLeftWidth: 3 },
  divider: { height: 1, marginVertical: 8 },
  placeholder: { fontSize: 14, paddingVertical: 4 },

  heroCard: {
    borderRadius: 16, padding: 20, marginBottom: 12,
    borderTopWidth: 2, overflow: 'hidden',
  },
  heroGlowLeft: {
    opacity: 0.25, borderRadius: 16,
    left: -40, top: -40, right: '40%', bottom: -40,
  },
  heroGlowRight: {
    opacity: 0.0, borderRadius: 16,
  },
  heroAmount: {
    color: '#fff', fontSize: 38, fontWeight: '700',
    fontFamily: 'monospace', marginBottom: 4,
  },
  heroGross: {
    color: '#ffffff88', fontSize: 13, marginBottom: 14,
  },
  stackedBar: {
    height: 6, flexDirection: 'row', borderRadius: 3, overflow: 'hidden', marginBottom: 12,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLabel: { color: '#ffffffaa', fontSize: 12 },

  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tile: {
    flex: 1, borderRadius: 16, padding: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  tileValue: { fontSize: 32, fontWeight: '700', fontFamily: 'monospace' },
  tileLabel: { fontSize: 12, marginTop: 6 },
  tileSub: { fontSize: 11, marginTop: 2 },

  normRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 5,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  normPct: { fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },

  breakdownRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  breakdownLabel: { flex: 1, fontSize: 14 },
  breakdownAmount: { fontSize: 14, fontWeight: '600', fontFamily: 'monospace' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10, flexShrink: 0 },

  tripRow: { paddingVertical: 12 },
  tripTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  tripRoute: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  typeChip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  typeChipText: { fontSize: 11, fontWeight: '600' },
  tripMeta: { flexDirection: 'row', gap: 12 },
  tripMetaText: { fontSize: 12 },
  moreText: { fontSize: 12, textAlign: 'center', marginTop: 6 },

  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  metricLabel: { fontSize: 14, flex: 1, paddingRight: 8 },
  metricValue: { fontSize: 14, fontWeight: '600' },
  monoLarge: { fontSize: 24, fontWeight: '700', fontFamily: 'monospace', marginTop: 4 },

  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
});
