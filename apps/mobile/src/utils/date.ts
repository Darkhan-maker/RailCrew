import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { SummaryQuery, PeriodType } from '@railcrew/contracts';

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
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
    from: format(from, 'yyyy-MM-dd'),
    to: format(to, 'yyyy-MM-dd'),
  };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} ч ${m} мин`;
}

export function formatDateRu(iso: string): string {
  return format(new Date(iso), 'd MMMM yyyy', { locale: ru });
}
