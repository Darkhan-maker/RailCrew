import { Injectable, NotFoundException } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import PDFDocument = require('pdfkit');
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { TripTypeLabelMap } from '@railcrew/contracts';

type TripRecord = any;

function formatDur(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

function sectionConsumption(start: number | null, end: number | null, stored: number | null): number | null {
  if (stored != null) return stored;
  if (start != null && end != null) return end - start;
  return null;
}

function totalEnergy(trip: TripRecord): number | null {
  const sections = [
    sectionConsumption(trip.energy1Start, trip.energy1End, trip.energy1Consumption),
    sectionConsumption(trip.energy2Start, trip.energy2End, trip.energy2Consumption),
    sectionConsumption(trip.energy3Start, trip.energy3End, trip.energy3Consumption),
  ].filter((v): v is number => v != null);
  return sections.length > 0 ? sections.reduce((a, b) => a + b, 0) : null;
}

function tripTypeLabel(type: string): string {
  return TripTypeLabelMap[type as keyof typeof TripTypeLabelMap] ?? type;
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTripsForPeriod(userId: string, from: string, to: string): Promise<TripRecord[]> {
    return this.prisma.trip.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    }) as unknown as Promise<TripRecord[]>;
  }

  private async getOneTrip(userId: string, id: string): Promise<TripRecord> {
    const trip = await this.prisma.trip.findFirst({ where: { id, userId } });
    if (!trip) throw new NotFoundException('Поездка не найдена');
    return trip as unknown as TripRecord;
  }

  async exportPeriodPdf(userId: string, from: string, to: string, reply: FastifyReply): Promise<void> {
    const trips = await this.getTripsForPeriod(userId, from, to);

    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve) => {
      doc.on('end', () => resolve());

      doc.fontSize(16).text(`Отчёт по поездкам: ${from} — ${to}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(11).text(`Всего поездок: ${trips.length}`, { align: 'center' });
      doc.moveDown(1);

      for (const trip of trips) {
        this.renderTripBlock(doc, trip);
        doc.moveDown(0.5);
        doc.moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .strokeColor('#cccccc')
          .stroke();
        doc.moveDown(0.5);
      }

      doc.end();
    });

    const buffer = Buffer.concat(chunks);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="trips-${from}-${to}.pdf"`)
      .send(buffer);
  }

  async exportOneTripPdf(userId: string, id: string, reply: FastifyReply): Promise<void> {
    const trip = await this.getOneTrip(userId, id);

    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve) => {
      doc.on('end', () => resolve());
      this.renderTripBlock(doc, trip);
      doc.end();
    });

    const buffer = Buffer.concat(chunks);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="trip-${id}.pdf"`)
      .send(buffer);
  }

  private renderTripBlock(doc: InstanceType<typeof PDFDocument>, trip: TripRecord): void {
    doc.fontSize(13).fillColor('#000000').text(`${trip.routeFrom} — ${trip.routeTo}`);
    doc.fontSize(10).fillColor('#555555').text(
      `${trip.date}${trip.endDate && trip.endDate !== trip.date ? ` → ${trip.endDate}` : ''}  ·  ${tripTypeLabel(trip.tripType)}`,
    );
    doc.moveDown(0.3);

    if (trip.trainNumber) doc.text(`Номер поезда: ${trip.trainNumber}`);
    if (trip.locoModel || trip.locoNumber) {
      doc.text(`Локомотив: ${[trip.locoModel, trip.locoNumber].filter(Boolean).join(' ')}`);
    }
    if (trip.trainWeight != null) doc.text(`Вес поезда: ${trip.trainWeight} т`);
    if (trip.axleCount != null) doc.text(`Осей: ${trip.axleCount}`);
    if (trip.appearanceDate && trip.appearanceTime) {
      doc.text(`Явка: ${trip.appearanceDate} ${trip.appearanceTime}`);
    }
    if (trip.handoverDate && trip.handoverTime) {
      doc.text(`Сдача: ${trip.handoverDate} ${trip.handoverTime}`);
    }

    doc.text(`Длительность: ${formatDur(trip.durationMinutes)}`);

    const e1c = sectionConsumption(trip.energy1Start, trip.energy1End, trip.energy1Consumption);
    const e2c = sectionConsumption(trip.energy2Start, trip.energy2End, trip.energy2Consumption);
    const e3c = sectionConsumption(trip.energy3Start, trip.energy3End, trip.energy3Consumption);

    if (trip.energy1Start != null || trip.energy1End != null || e1c != null) {
      doc.text(`Сек.1: нач. ${trip.energy1Start ?? '—'}, кон. ${trip.energy1End ?? '—'}, расход ${e1c != null ? e1c.toFixed(0) : '—'} кВт·ч`);
    }
    if (trip.energy2Start != null || trip.energy2End != null || e2c != null) {
      doc.text(`Сек.2: нач. ${trip.energy2Start ?? '—'}, кон. ${trip.energy2End ?? '—'}, расход ${e2c != null ? e2c.toFixed(0) : '—'} кВт·ч`);
    }
    if (trip.energy3Start != null || trip.energy3End != null || e3c != null) {
      doc.text(`Сек.3: нач. ${trip.energy3Start ?? '—'}, кон. ${trip.energy3End ?? '—'}, расход ${e3c != null ? e3c.toFixed(0) : '—'} кВт·ч`);
    }

    const total = totalEnergy(trip);
    if (total != null) {
      doc.text(`Итого расход: ${total.toFixed(0)} кВт·ч`);
    }

    if (trip.notes) {
      doc.moveDown(0.2);
      doc.fillColor('#333333').text(`Примечание: ${trip.notes}`);
    }
    doc.fillColor('#000000');
  }

  async exportPeriodXlsx(userId: string, from: string, to: string, reply: FastifyReply): Promise<void> {
    const trips = await this.getTripsForPeriod(userId, from, to);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Поездки');

    ws.columns = [
      { header: 'Дата', key: 'date', width: 12 },
      { header: 'Маршрут', key: 'route', width: 30 },
      { header: 'Тип', key: 'type', width: 14 },
      { header: 'Локомотив', key: 'loco', width: 18 },
      { header: 'Номер поезда', key: 'trainNum', width: 14 },
      { header: 'Вес, т', key: 'weight', width: 10 },
      { header: 'Осей', key: 'axles', width: 8 },
      { header: 'Явка', key: 'appearance', width: 18 },
      { header: 'Сдача', key: 'handover', width: 18 },
      { header: 'Длительность', key: 'duration', width: 14 },
      { header: 'Сек.1 нач.', key: 'e1s', width: 10 },
      { header: 'Сек.1 кон.', key: 'e1e', width: 10 },
      { header: 'Сек.1 расход', key: 'e1c', width: 12 },
      { header: 'Сек.2 нач.', key: 'e2s', width: 10 },
      { header: 'Сек.2 кон.', key: 'e2e', width: 10 },
      { header: 'Сек.2 расход', key: 'e2c', width: 12 },
      { header: 'Сек.3 нач.', key: 'e3s', width: 10 },
      { header: 'Сек.3 кон.', key: 'e3e', width: 10 },
      { header: 'Сек.3 расход', key: 'e3c', width: 12 },
      { header: 'Итого расход', key: 'etotal', width: 14 },
      { header: 'Примечание', key: 'notes', width: 30 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    for (const trip of trips) {
      const e1c = sectionConsumption(trip.energy1Start, trip.energy1End, trip.energy1Consumption);
      const e2c = sectionConsumption(trip.energy2Start, trip.energy2End, trip.energy2Consumption);
      const e3c = sectionConsumption(trip.energy3Start, trip.energy3End, trip.energy3Consumption);
      const etotal = totalEnergy(trip);

      ws.addRow({
        date: trip.date,
        route: `${trip.routeFrom} — ${trip.routeTo}`,
        type: tripTypeLabel(trip.tripType),
        loco: [trip.locoModel, trip.locoNumber].filter(Boolean).join(' ') || null,
        trainNum: trip.trainNumber,
        weight: trip.trainWeight,
        axles: trip.axleCount,
        appearance: trip.appearanceDate && trip.appearanceTime ? `${trip.appearanceDate} ${trip.appearanceTime}` : null,
        handover: trip.handoverDate && trip.handoverTime ? `${trip.handoverDate} ${trip.handoverTime}` : null,
        duration: formatDur(trip.durationMinutes),
        e1s: trip.energy1Start,
        e1e: trip.energy1End,
        e1c,
        e2s: trip.energy2Start,
        e2e: trip.energy2End,
        e2c,
        e3s: trip.energy3Start,
        e3e: trip.energy3End,
        e3c,
        etotal,
        notes: trip.notes,
      });
    }

    const buffer = await wb.xlsx.writeBuffer() as Buffer;
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="trips-${from}-${to}.xlsx"`)
      .send(buffer);
  }
}
