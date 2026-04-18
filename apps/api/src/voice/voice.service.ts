import { Injectable } from '@nestjs/common';
import { VoiceRecognitionResult, TripType } from '@railcrew/contracts';
import { PrismaService } from '../prisma/prisma.service';

const MONTHS_RU: Record<string, string> = {
  января: '01', февраля: '02', марта: '03', апреля: '04',
  мая: '05', июня: '06', июля: '07', августа: '08',
  сентября: '09', октября: '10', ноября: '11', декабря: '12',
};

const TRIP_TYPE_MAP: Array<[RegExp, TripType]> = [
  [/груз/i, 'FREIGHT'],
  [/пассаж/i, 'PASSENGER'],
  [/манев/i, 'SHUNTING'],
  [/резерв/i, 'DEAD_RUN'],
];

@Injectable()
export class VoiceService {
  constructor(private readonly prisma: PrismaService) {}

  parse(rawText: string, userId: string): VoiceRecognitionResult {
    const text = rawText.trim();
    const ambiguities: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields: any = {};

    // Маршрут: "Слово - Слово" или "из X в Y"
    const routeMatch = text.match(/([А-Яа-яЁё\w]+)\s*[-–—]\s*([А-Яа-яЁё\w]+)/);
    if (routeMatch) {
      fields.routeFrom = routeMatch[1];
      fields.routeTo = routeMatch[2];
    } else {
      ambiguities.push('Не удалось определить маршрут');
    }

    // Дата: "3 апреля" / "03.04" / "03.04.2025"
    const dateRu = text.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i);
    const dateDot = text.match(/(\d{2})\.(\d{2})(?:\.(\d{4}))?/);
    if (dateRu) {
      const day = dateRu[1].padStart(2, '0');
      const month = MONTHS_RU[dateRu[2].toLowerCase()];
      const year = new Date().getFullYear();
      fields.date = `${year}-${month}-${day}`;
    } else if (dateDot) {
      const year = dateDot[3] ?? String(new Date().getFullYear());
      fields.date = `${year}-${dateDot[2]}-${dateDot[1]}`;
    } else {
      ambiguities.push('Не удалось определить дату');
    }

    // Время начала и окончания
    const times = [...text.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
    const startKw = text.match(/начал[оа]?\s+(\d{1,2}:\d{2})/i);
    const endKw = text.match(/оконч[а-я]+\s+(\d{1,2}:\d{2})/i);

    if (startKw) fields.startTime = startKw[1].padStart(5, '0');
    else if (times[0]) fields.startTime = times[0];
    else ambiguities.push('Не удалось определить время начала');

    if (endKw) fields.endTime = endKw[1].padStart(5, '0');
    else if (times[1]) fields.endTime = times[1];
    else ambiguities.push('Не удалось определить время окончания');

    // Длительность
    if (fields.startTime && fields.endTime) {
      const [sh, sm] = fields.startTime.split(':').map(Number);
      const [eh, em] = fields.endTime.split(':').map(Number);
      let dur = (eh * 60 + em) - (sh * 60 + sm);
      if (dur < 0) dur += 24 * 60;
      fields.durationMinutes = dur;
    }

    // Тип поездки
    for (const [re, type] of TRIP_TYPE_MAP) {
      if (re.test(text)) { fields.tripType = type; break; }
    }
    if (!fields.tripType) ambiguities.push('Не удалось определить тип поездки');

    const confidence = 1 - ambiguities.length * 0.2;

    // Сохраняем запись голосового ввода
    void this.prisma.voiceInput.create({
      data: { userId, rawText, parsedFields: fields, confidence },
    });

    return { rawText, parsedFields: fields, confidence: Math.max(0, confidence), ambiguities };
  }
}
