import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTripDto, TripQuery, TripSchema, TripListResponse } from '@railcrew/contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTripDto) {
    const trip = await this.prisma.trip.create({
      data: { ...dto, userId, syncedAt: new Date() },
    });
    return TripSchema.parse(trip);
  }

  async findAll(userId: string, query: TripQuery): Promise<TripListResponse> {
    const where = {
      userId,
      ...(query.from && { date: { gte: query.from } }),
      ...(query.to && { date: { lte: query.to } }),
      ...(query.tripType && { tripType: query.tripType }),
      ...(query.status && { status: query.status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.trip.count({ where }),
    ]);

    return { items: items.map((t: unknown) => TripSchema.parse(t)), total };
  }

  async findOne(userId: string, id: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id, userId } });
    if (!trip) throw new NotFoundException('Поездка не найдена');
    return TripSchema.parse(trip);
  }

  async update(userId: string, id: string, dto: Partial<CreateTripDto>) {
    await this.findOne(userId, id);
    const updated = await this.prisma.trip.update({
      where: { id },
      data: dto,
    });
    return TripSchema.parse(updated);
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.trip.delete({ where: { id } });
  }

  // Используется для сводок
  findForPeriod(userId: string, from: string, to: string): Promise<{ id: string; durationMinutes: number; startTime: string; routeFrom: string; routeTo: string }[]> {
    return this.prisma.trip.findMany({
      where: {
        userId,
        date: { gte: from, lte: to },
        status: 'CONFIRMED',
      },
    });
  }
}
