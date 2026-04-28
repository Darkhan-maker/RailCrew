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
  // Matches: "ВЛ80 569", "ВЛ80С-569", "2ТЭ116 569", "ТЭП70 №012"
  const m = text.match(/([А-ЯA-Z0-9]{2,}(?:[А-ЯA-Zа-яa-z]?[-]?\d*)?)\s*[№#]?\s*(\d{1,5})/u);
  if (m) {
    return { locoModel: m[1], locoNumber: m[2] };
  }
  const modelOnly = text.match(/\b([А-ЯA-Z]{2,}(?:\d+)?[А-ЯA-Z]?)\b/u);
  if (modelOnly) return { locoModel: modelOnly[1] };
  return {};
}

export interface ParsedTrip {
  routeFrom: string;
  routeTo: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  tripType: TripType;
  locoModel?: string;
  locoNumber?: string;
  trainNumber?: string;
}

export function parseTripText(text: string): ParsedTrip | null {
  // Normalize
  const t = text.trim();

  // Extract route: "Астана-Алматы" or "Астана — Алматы" or "Астана Алматы"
  let routeFrom = '';
  let routeTo = '';
  const routeMatch = t.match(/^([А-ЯЁа-яё\w]+(?:[\s-][А-ЯЁа-яё\w]+)*?)\s*[-–—]\s*([А-ЯЁа-яё\w]+(?:\s[А-ЯЁа-яё\w]+)?)/u);
  if (routeMatch) {
    routeFrom = routeMatch[1].trim();
    routeTo = routeMatch[2].trim();
  } else {
    // Try "от Астаны до Алматы" or just two capitalized words
    const words = t.split(/\s+/);
    if (words.length >= 2) {
      routeFrom = words[0];
      routeTo = words[1];
    }
  }

  if (!routeFrom || !routeTo) return null;

  // Date
  const date = parseDate(t);
  if (!date) return null;

  // Times: look for "явка HH:mm" / "сдача HH:mm" or bare times
  let startTime: string | null = null;
  let endTime: string | null = null;

  const явкаMatch = t.match(/(?:явк[аи]|отправл|выезд)\s+(\d{1,2}[:\-]\d{2})/iu);
  const сдачаMatch = t.match(/(?:сдач[аи]|прибыт|заезд|приезд)\s+(\d{1,2}[:\-]\d{2})/iu);

  if (явкаMatch) startTime = parseTime(явкаMatch[1]);
  if (сдачаMatch) endTime = parseTime(сдачаMatch[1]);

  // Fallback: find all HH:MM in text
  if (!startTime || !endTime) {
    const times = [...t.matchAll(/\b(\d{1,2}[:\-]\d{2})\b/g)].map(m => parseTime(m[1])).filter(Boolean) as string[];
    if (!startTime && times.length >= 1) startTime = times[0];
    if (!endTime && times.length >= 2) endTime = times[1];
  }

  if (!startTime || !endTime) return null;

  const durationMinutes = calcDuration(startTime, endTime);
  const tripType = parseTripType(t);

  // Loco: look for pattern after trip type or at end
  const locoSection = t.replace(/явк[аи]/iu, '').replace(/сдач[аи]/iu, '');
  const { locoModel, locoNumber } = parseLocoModel(locoSection);

  // Train number: look for "поезд 1234" or "№1234"
  let trainNumber: string | undefined;
  const trainMatch = t.match(/(?:поезд|п\.|train)\s*[№#]?\s*(\d+)/iu);
  if (trainMatch) trainNumber = trainMatch[1];

  return {
    routeFrom,
    routeTo,
    date,
    startTime,
    endTime,
    durationMinutes,
    tripType,
    locoModel,
    locoNumber,
    trainNumber,
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
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      durationMinutes: parsed.durationMinutes,
      tripType: parsed.tripType,
      status: 'CONFIRMED',
      locoModel: parsed.locoModel,
      locoNumber: parsed.locoNumber,
      trainNumber: parsed.trainNumber,
    };

    const trip = await this.tripsService.create(userId, dto);
    return { ok: true, trip };
  }
}
