import { useState, useMemo, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { localSalaryStorage, LocalSalaryRule } from '@/services/storage.service';
import { TripType } from '@railcrew/contracts';
import { useLang } from '@/i18n';
import { useTheme, Theme } from '@/theme';

// ─── Calculation ──────────────────────────────────────────────────────────────

function calcFromHours(
  rule: LocalSalaryRule,
  totalHours: number,
  nightHours: number,
  holidayHours: number,
  overtimeHours: number,
  tripCount: number,
) {
  const rate = rule.ratePerHour;
  const regularHours = Math.max(0, totalHours - nightHours - holidayHours - overtimeHours);

  const tariffPay = Math.round(regularHours * rate);
  const nightPay = Math.round(nightHours * rate * (rule.nightCoefficient || 1.4));
  const holidayPay = Math.round(holidayHours * rate * (rule.holidayCoefficient || 2));
  const overtimePay = Math.round(overtimeHours * rate * (rule.overtimeCoefficient || 1.5));
  const tripBonusPay = Math.round(
    tripCount * (rule.tripBonus || 0) + totalHours * (rule.tripBonusPerHour || 0),
  );

  const harmfulnessPay = Math.round(tariffPay * (rule.harmfulnessPercent || 0) / 100);
  const classPay = Math.round(tariffPay * (rule.classPercent || 0) / 100);
  const zonalPay = Math.round(tariffPay * (rule.zonalPercent || 0) / 100);

  const subtotalBeforeRK =
    tariffPay + nightPay + holidayPay + overtimePay + tripBonusPay +
    harmfulnessPay + classPay + zonalPay;

  const rk = rule.regionalCoefficient || 1;
  const gross = Math.round(subtotalBeforeRK * rk);

  const unionDeduction = Math.round(gross * (rule.unionPercent || 0) / 100);
  const taxDeduction = Math.round((gross - unionDeduction) * (rule.taxPercent || 13) / 100);
  const netPay = gross - unionDeduction - taxDeduction;

  return {
    regularHours,
    tariffPay, nightPay, holidayPay, overtimePay, tripBonusPay,
    harmfulnessPay, classPay, zonalPay,
    subtotalBeforeRK, gross, rk, unionDeduction, taxDeduction, netPay,
  };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const TYPES: TripType[] = ['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN'];

export default function CalculatorScreen() {
  const { t } = useLang();
  const { theme } = useTheme();

  const [rule, setRule] = useState<LocalSalaryRule | null>(null);
  const [totalHours, setTotalHours] = useState('');
  const [nightHours, setNightHours] = useState('');
  const [holidayHours, setHolidayHours] = useState('');
  const [overtimeHours, setOvertimeHours] = useState('');
  const [tripCount, setTripCount] = useState('');
  const [tripType, setTripType] = useState<TripType>('FREIGHT');

  useEffect(() => {
    localSalaryStorage.get().then(setRule);
  }, []);

  const result = useMemo(() => {
    if (!rule || rule.ratePerHour === 0) return null;
    const th = parseFloat(totalHours) || 0;
    if (th === 0) return null;
    const nh = parseFloat(nightHours) || 0;
    const hh = parseFloat(holidayHours) || 0;
    const oh = parseFloat(overtimeHours) || 0;
    const tc = parseInt(tripCount, 10) || 0;
    return calcFromHours(rule, th, nh, hh, oh, tc);
  }, [rule, totalHours, nightHours, holidayHours, overtimeHours, tripCount]);

  const fmt = (n: number) => Math.round(n).toLocaleString() + ' ₸';
  const fmtH = (h: number) => `${Math.round(h * 10) / 10} ч`;

  const tripTypeLabel = (type: TripType): string => ({
    FREIGHT: t.tripType_FREIGHT,
    PASSENGER: t.tripType_PASSENGER,
    SHUNTING: t.tripType_SHUNTING,
    DEAD_RUN: t.tripType_DEAD_RUN,
  })[type] ?? type;

  const inputStyle = [s.input, {
    backgroundColor: theme.surface, color: theme.text, borderColor: theme.border,
  }];

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: theme.bg }]}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 60 }}
    >
      {/* Header */}
      <TouchableOpacity onPress={() => router.back()} style={s.back}>
        <Ionicons name="chevron-back" size={20} color={theme.primary} />
        <Text style={[s.backText, { color: theme.primary }]}>{t.detail_back}</Text>
      </TouchableOpacity>
      <Text style={[s.title, { color: theme.text }]}>{t.calc_title}</Text>

      {/* Rate hint */}
      {rule && rule.ratePerHour > 0 && (
        <Text style={[s.rateHint, { color: theme.textMute }]}>
          {t.settings_ratePerHour}: {rule.ratePerHour.toLocaleString()} ₸
        </Text>
      )}

      {/* Inputs */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Field theme={theme} label={t.calc_totalHours} value={totalHours} onChange={setTotalHours} />
        <Field theme={theme} label={t.calc_nightHours} value={nightHours} onChange={setNightHours} />
        <Field theme={theme} label={t.calc_holidayHours} value={holidayHours} onChange={setHolidayHours} />
        <Field theme={theme} label={t.calc_overtimeHours} value={overtimeHours} onChange={setOvertimeHours} />
        <Field theme={theme} label={t.calc_tripCount} value={tripCount} onChange={setTripCount} integer />
      </View>

      {/* Trip type */}
      <View style={[s.card, { backgroundColor: theme.card }]}>
        <Text style={[s.sectionLabel, { color: theme.textDim }]}>{t.add_tripType}</Text>
        <View style={s.chipRow}>
          {TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={[
                s.chip,
                { backgroundColor: theme.surface, borderColor: theme.border },
                tripType === type && { backgroundColor: theme.primary, borderColor: theme.primary },
              ]}
              onPress={() => setTripType(type)}
            >
              <Text style={[
                s.chipText, { color: theme.textMute },
                tripType === type && { color: '#fff', fontWeight: '600' },
              ]}>
                {tripTypeLabel(type)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* No rate warning */}
      {(!rule || rule.ratePerHour === 0) && (
        <View style={[s.card, { backgroundColor: theme.card }]}>
          <View style={s.noRateRow}>
            <Ionicons name="warning-outline" size={18} color={theme.warning} />
            <Text style={[s.noRateText, { color: theme.warning }]}>{t.calc_noRate}</Text>
          </View>
        </View>
      )}

      {/* Result breakdown */}
      {result && (
        <View style={[s.card, { backgroundColor: theme.card }]}>
          <Text style={[s.sectionLabel, { color: theme.textDim }]}>{t.calc_result}</Text>

          <ResultRow
            theme={theme} color={theme.primary}
            label={t.dashboard_tariff} sub={fmtH(result.regularHours)} amount={result.tariffPay}
          />
          {result.nightPay > 0 && (
            <ResultRow
              theme={theme} color="#8B5CF6"
              label={t.dashboard_nightAddon} sub={fmtH(parseFloat(nightHours) || 0)} amount={result.nightPay}
            />
          )}
          {result.holidayPay > 0 && (
            <ResultRow
              theme={theme} color={theme.warning}
              label={t.dashboard_holidayAddon} sub={fmtH(parseFloat(holidayHours) || 0)} amount={result.holidayPay}
            />
          )}
          {result.overtimePay > 0 && (
            <ResultRow
              theme={theme} color={theme.warning}
              label={t.dashboard_overtimeAddon} sub={fmtH(parseFloat(overtimeHours) || 0)} amount={result.overtimePay}
            />
          )}
          {result.tripBonusPay > 0 && (
            <ResultRow theme={theme} color={theme.success} label={t.dashboard_tripBonuses} amount={result.tripBonusPay} />
          )}
          {result.harmfulnessPay > 0 && (
            <ResultRow theme={theme} color="#F97316" label={t.dashboard_harmfulness} amount={result.harmfulnessPay} />
          )}
          {result.classPay > 0 && (
            <ResultRow theme={theme} color="#06B6D4" label={t.dashboard_classBonus} amount={result.classPay} />
          )}
          {result.zonalPay > 0 && (
            <ResultRow theme={theme} color="#84CC16" label={t.dashboard_zonalBonus} amount={result.zonalPay} />
          )}

          <View style={[s.divider, { backgroundColor: theme.border }]} />
          <ResultRow
            theme={theme}
            label={t.dashboard_regionalCoeff}
            sub={`× ${result.rk.toFixed(2)}`}
            amount={result.gross - result.subtotalBeforeRK}
          />

          <View style={[s.divider, { backgroundColor: theme.border }]} />
          <ResultRow theme={theme} label={t.dashboard_subtotal} amount={result.gross} highlight />

          {result.unionDeduction > 0 && (
            <ResultRow theme={theme} label={t.dashboard_union} amount={result.unionDeduction} deduction />
          )}
          {result.taxDeduction > 0 && (
            <ResultRow theme={theme} label={t.dashboard_ndfl} amount={result.taxDeduction} deduction />
          )}

          <View style={[s.divider, { backgroundColor: theme.border }]} />
          <View style={[s.netRow, { backgroundColor: theme.primaryDim }]}>
            <Text style={[s.netLabel, { color: theme.text }]}>{t.dashboard_netPay}</Text>
            <Text style={[s.netAmount, { color: theme.primary }]}>{fmt(result.netPay)}</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  theme, label, value, onChange, integer,
}: {
  theme: Theme;
  label: string;
  value: string;
  onChange: (v: string) => void;
  integer?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: theme.textDim }]}>{label}</Text>
      <TextInput
        style={[s.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
        value={value}
        onChangeText={onChange}
        keyboardType={integer ? 'number-pad' : 'decimal-pad'}
        placeholder="0"
        placeholderTextColor={theme.textMute}
      />
    </View>
  );
}

function ResultRow({
  theme, label, sub, amount, color, deduction, highlight,
}: {
  theme: Theme;
  label: string;
  sub?: string;
  amount: number;
  color?: string;
  deduction?: boolean;
  highlight?: boolean;
}) {
  const amountColor = deduction ? theme.danger : highlight ? theme.primary : theme.text;
  const sign = deduction ? '−' : '';
  return (
    <View style={s.resultRow}>
      {color
        ? <View style={[s.dot, { backgroundColor: color }]} />
        : <View style={s.dotEmpty} />
      }
      <View style={{ flex: 1 }}>
        <Text style={[s.resultLabel, { color: highlight ? theme.text : theme.textDim }, highlight && { fontWeight: '600' }]}>
          {label}
        </Text>
        {sub ? <Text style={[s.resultSub, { color: theme.textMute }]}>{sub}</Text> : null}
      </View>
      <Text style={[s.resultAmount, { color: amountColor }, highlight && { fontSize: 16, fontWeight: '700' }]}>
        {sign}{Math.round(Math.abs(amount)).toLocaleString()} ₸
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  back: { flexDirection: 'row', alignItems: 'center', marginTop: 48, marginBottom: 8, gap: 2 },
  backText: { fontSize: 15 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  rateHint: { fontSize: 13, marginBottom: 12 },

  card: { borderRadius: 16, padding: 16, marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 },
  divider: { height: 1, marginVertical: 8 },

  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, marginBottom: 5 },
  input: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13 },

  noRateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noRateText: { fontSize: 14, flex: 1 },

  resultRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10, flexShrink: 0 },
  dotEmpty: { width: 8, marginRight: 10 },
  resultLabel: { fontSize: 14 },
  resultSub: { fontSize: 11, marginTop: 1 },
  resultAmount: { fontSize: 14, fontWeight: '600', fontFamily: 'monospace', marginLeft: 8 },

  netRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, marginTop: 4,
  },
  netLabel: { fontSize: 15, fontWeight: '600' },
  netAmount: { fontSize: 26, fontWeight: '700', fontFamily: 'monospace' },
});
