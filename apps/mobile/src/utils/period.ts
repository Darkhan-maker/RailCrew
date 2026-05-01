import { LocalTrip } from '@/services/storage.service';

export type PeriodKey = 'ALL' | 'DAY' | 'WEEK' | 'MONTH';

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
