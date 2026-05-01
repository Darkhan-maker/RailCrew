import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { SummaryQuery, PeriodType } from '@railcrew/contracts';

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return localDateStr(new Date());
}

export function buildSummaryQuery(periodType: PeriodType): SummaryQuery {
  const now = new Date();
  let from: Date, to: Date;

  switch (periodType) {
    case 'DAY':
      from = now; to = now; break;
    case 'WEEK':
      from = startOfWeek(now, { weekStartsOn: 1 });
      to = endOfWeek(now, { weekStartsOn: 1 });
      break;
    case 'MONTH':
      from = startOfMonth(now);
      to = endOfMonth(now);
      break;
    default:
      from = now; to = now;
  }

  return {
    periodType,
    from: localDateStr(from),
    to: localDateStr(to),
  };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} ч ${m} мин`;
}

export function formatDateRu(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'd MMMM yyyy', { locale: ru });
}
