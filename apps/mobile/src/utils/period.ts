import { LocalTrip } from '@/services/storage.service';

export type PeriodKey = 'ALL' | 'DAY' | 'WEEK' | 'MONTH';
export type MonthHours = { yearMonth: string; hours: number };
export type DayHours = { date: string; hours: number };

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function getPeriodBounds(period: PeriodKey): { from: string; to: string } | null {
  if (period === 'ALL') return null;
  const today = toLocalDateStr(new Date());
  switch (period) {
    case 'DAY': return { from: today, to: today };
    case 'WEEK': return { from: toLocalDateStr(addDays(new Date(), -6)), to: today };
    case 'MONTH': return { from: toLocalDateStr(addDays(new Date(), -29)), to: today };
  }
}

export function filterTripsByPeriod(trips: LocalTrip[], period: PeriodKey): LocalTrip[] {
  const bounds = getPeriodBounds(period);
  if (!bounds) return trips;
  return trips.filter((tr) => {
    const d = (tr.date ?? '').slice(0, 10);
    return d >= bounds.from && d <= bounds.to;
  });
}

function getTripTimeRange(trip: LocalTrip): { startMs: number; endMs: number } {
  const startMs = new Date(`${trip.date}T${trip.startTime ?? '00:00'}:00`).getTime();
  const endMs = startMs + (trip.durationMinutes ?? 0) * 60000;
  return { startMs, endMs };
}

export function splitTripByMonth(trip: LocalTrip): MonthHours[] {
  const { startMs, endMs } = getTripTimeRange(trip);
  if (endMs <= startMs) {
    return [{ yearMonth: trip.date.slice(0, 7), hours: (trip.durationMinutes ?? 0) / 60 }];
  }
  const result: MonthHours[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const d = new Date(cur);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const nextMonthStart = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const segEnd = Math.min(nextMonthStart, endMs);
    const hours = (segEnd - cur) / 3600000;
    const existing = result.find((r) => r.yearMonth === yearMonth);
    if (existing) existing.hours += hours;
    else result.push({ yearMonth, hours });
    cur = segEnd;
  }
  return result;
}

export function splitTripByDay(trip: LocalTrip): DayHours[] {
  const { startMs, endMs } = getTripTimeRange(trip);
  if (endMs <= startMs) {
    return [{ date: trip.date, hours: (trip.durationMinutes ?? 0) / 60 }];
  }
  const result: DayHours[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const d = new Date(cur);
    const date = toLocalDateStr(d);
    const nextDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const segEnd = Math.min(nextDayStart, endMs);
    const hours = (segEnd - cur) / 3600000;
    const existing = result.find((r) => r.date === date);
    if (existing) existing.hours += hours;
    else result.push({ date, hours });
    cur = segEnd;
  }
  return result;
}
