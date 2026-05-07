import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';
import { CreateTripDto, TripType } from '@railcrew/contracts';

// ─── Text parser ─────────────────────────────────────────────────────────────

const MONTHS_RU: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, май: 5, ма: 5,
  июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};

function parseMonth(word: string): number | null {
  const w = word.toLowerCase().replace(/ь$|я$|е$/, '');
  for (const [key, val] of Object.entries(MONTHS_RU)) {
    if (w.startsWith(key)) return val;
  }
  return null;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(text: string): string | null {
  // "7 апреля", "15.04", "15.04.2025", "07.04"
  const full = text.match(/(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{4}))?/);
  if (full) {
    const day = full[1].padStart(2, '0');
    const month = full[2].padStart(2, '0');
    const year = full[3] ?? new Date().getFullYear().toString();
    return `${year}-${month}-${day}`;
  }
  const textMatch = text.match(/(\d{1,2})\s+([а-яёА-ЯЁ]+)/u);
  if (textMatch) {
    const day = textMatch[1].padStart(2, '0');
    const month = parseMonth(textMatch[2]);
    if (month) {
      const year = new Date().getFullYear();
      return `${year}-${month.toString().padStart(2, '0')}-${day}`;
    }
  }
  if (/\bсегодня\b/iu.test(text)) return isoDate(new Date());
  if (/\bзавтра\b/iu.test(text)) {
    const d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d);
  }
  return null;
}

function parseTime(s: string): string | null {
  const m = s.match(/(\d{1,2})[:\-](\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function calcDuration(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const diff = endMin >= startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
  return diff;
}

function parseTripType(text: string): TripType {
  const t = text.toLowerCase();
  if (t.includes('пассажир') || t.includes('passenger')) return 'PASSENGER';
  if (t.includes('маневр') || t.includes('shunting')) return 'SHUNTING';
  if (t.includes('резерв') || t.includes('dead')) return 'DEAD_RUN';
  return 'FREIGHT';
}

function parseLocoModel(text: string): { locoModel?: string; locoNumber?: string } {
  // Series: optional leading digits + uppercase Cyrillic/Latin + alphanumeric mix (e.g. ВЛ80, ВЛ80С, KZ8A, 2ТЭ10М)
  // Number: 3-5 digits (loco number)
  // Dash separator first, then space separator
  const dashMatch = text.match(/\b((?:\d+)?[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9]*)[-–](\d{3,5})\b/u);
  if (dashMatch) return { locoModel: dashMatch[1], locoNumber: dashMatch[2] };
  const spaceMatch = text.match(/\b((?:\d+)?[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9]*)\s+(\d{3,5})\b/u);
  if (spaceMatch) return { locoModel: spaceMatch[1], locoNumber: spaceMatch[2] };
  return {};
}

export interface ParsedTrip {
  routeFrom: string;
  routeTo: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  handoverDate?: string;
  handoverTime?: string;
  durationMinutes: number;
  tripType: TripType;
  locoModel?: string;
  locoNumber?: string;
  trainNumber?: string;
  conditionalLength?: number;
}

export function parseTripText(text: string): ParsedTrip | null {
  const t = text.trim();

  // Route: destination must be letters only (no digits) to avoid "Жарык 29 апреля"
  let routeFrom = '';
  let routeTo = '';
  // Each word in a station name must start with an uppercase letter (proper noun).
  // This prevents "сегодня"/"завтра" etc. from being captured as part of routeTo.
  const routeMatch = t.match(/^([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]*(?:[\s-][А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]*)*?)\s*[-–—]\s*([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]*(?:[\s-][А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]*)?)/u);
  if (routeMatch) {
    routeFrom = routeMatch[1].trim();
    routeTo = routeMatch[2].trim();
  } else {
    const words = t.split(/\s+/);
    if (words.length >= 2) {
      routeFrom = words[0];
      routeTo = words[1];
    }
  }

  if (!routeFrom || !routeTo) return null;

  // Date (first date in text = явка date)
  const date = parseDate(t);
  if (!date) return null;

  // Times: try "явка HH:mm" and "сдача [DD Month] HH:mm"
  let startTime: string | null = null;
  let endTime: string | null = null;
  let handoverDate: string | undefined;

  const явкаMatch = t.match(/(?:явк[аи]|отправл|выезд)\s+(\d{1,2}[:\-]\d{2})/iu);
  if (явкаMatch) startTime = parseTime(явкаMatch[1]);

  // "Сдача завтра 02:15" — next day with keyword
  const сдачаTomorrowMatch = t.match(/(?:сдач[аи]|прибыт|заезд|приезд)\s+завтра\s+(\d{1,2}[:\-]\d{2})/iu);
  if (сдачаTomorrowMatch) {
    endTime = parseTime(сдачаTomorrowMatch[1]);
    const d = new Date(); d.setDate(d.getDate() + 1);
    handoverDate = isoDate(d);
  } else {
    // "Сдача 30 апреля 3:00" — multi-day with date before time
    const сдачаDateMatch = t.match(/(?:сдач[аи]|прибыт|заезд|приезд)\s+(\d{1,2})\s+([а-яёА-ЯЁ]+)\s+(\d{1,2}[:\-]\d{2})/iu);
    if (сдачаDateMatch) {
      endTime = parseTime(сдачаDateMatch[3]);
      const hdMonth = parseMonth(сдачаDateMatch[2]);
      if (hdMonth) {
        const hdDay = сдачаDateMatch[1].padStart(2, '0');
        const hdYear = new Date().getFullYear();
        handoverDate = `${hdYear}-${hdMonth.toString().padStart(2, '0')}-${hdDay}`;
      }
    } else {
      // "Сдача 3:00" — same day
      const сдачаMatch = t.match(/(?:сдач[аи]|прибыт|заезд|приезд)\s+(\d{1,2}[:\-]\d{2})/iu);
      if (сдачаMatch) endTime = parseTime(сдачаMatch[1]);
    }
  }

  // Fallback: find all HH:MM in text
  if (!startTime || !endTime) {
    const times = [...t.matchAll(/\b(\d{1,2}[:\-]\d{2})\b/g)].map(m => parseTime(m[1])).filter(Boolean) as string[];
    if (!startTime && times.length >= 1) startTime = times[0];
    if (!endTime && times.length >= 2) endTime = times[1];
  }

  if (!startTime || !endTime) return null;

  const durationMinutes = calcDuration(startTime, endTime);
  const tripType = parseTripType(t);

  const locoSection = t.replace(/явк[аи]/iu, '').replace(/сдач[аи]/iu, '');
  const { locoModel, locoNumber } = parseLocoModel(locoSection);

  let trainNumber: string | undefined;
  const trainMatch = t.match(/(?:поезд|п\.|train)\s*[№#]?\s*(\d+)/iu);
  if (trainMatch) trainNumber = trainMatch[1];

  // "усл 71", "услов 71", "условных 71" OR "71 усл", "71 усл." etc.
  let conditionalLength: number | undefined;
  const condPrefixMatch = t.match(/\bусл(?:ов(?:ных|но|ная|ный)?)?\b\.?\s+(\d+)/iu);
  const condSuffixMatch = t.match(/\b(\d+)\s+усл(?:ов(?:ных|но|ная|ный)?)?\b\.?/iu);
  if (condPrefixMatch) conditionalLength = parseInt(condPrefixMatch[1], 10);
  else if (condSuffixMatch) conditionalLength = parseInt(condSuffixMatch[1], 10);

  // endDate = handoverDate when it differs from the явка date
  const endDate = handoverDate && handoverDate !== date ? handoverDate : undefined;

  return {
    routeFrom,
    routeTo,
    date,
    startTime,
    endTime,
    endDate,
    handoverDate,
    handoverTime: endTime,
    durationMinutes,
    tripType,
    locoModel,
    locoNumber,
    trainNumber,
    conditionalLength,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class TelegramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tripsService: TripsService,
  ) {}

  async generateLinkCode(userId: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.prisma.user.update({
      where: { id: userId },
      data: { telegramLinkCode: code },
    });
    return code;
  }

  async linkByCode(code: string, telegramId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { telegramLinkCode: code },
      include: { profile: true },
    });
    if (!user) return null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { telegramId, telegramLinkCode: null },
    });

    const name = (user as any).profile
      ? `${(user as any).profile.firstName} ${(user as any).profile.lastName}`.trim()
      : user.email;
    return name;
  }

  async findUserByTelegramId(telegramId: string) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  async getRecentTrips(userId: string) {
    return this.prisma.trip.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    });
  }

  async createTripFromText(userId: string, text: string): Promise<{ ok: true; trip: unknown } | { ok: false; error: string }> {
    const parsed = parseTripText(text);
    if (!parsed) {
      return { ok: false, error: 'Не удалось распознать поездку. Попробуй формат:\nАстана-Алматы 7 апреля явка 08:00 сдача 16:30 грузовой ВЛ80 569' };
    }

    const dto: CreateTripDto = {
      routeFrom: parsed.routeFrom,
      routeTo: parsed.routeTo,
      date: parsed.date,
      endDate: parsed.endDate,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      durationMinutes: parsed.durationMinutes,
      tripType: parsed.tripType,
      status: 'CONFIRMED',
      locoModel: parsed.locoModel,
      locoNumber: parsed.locoNumber,
      trainNumber: parsed.trainNumber,
      handoverDate: parsed.handoverDate,
      handoverTime: parsed.handoverTime,
      conditionalLength: parsed.conditionalLength,
    };

    const trip = await this.tripsService.create(userId, dto);
    return { ok: true, trip };
  }
}
