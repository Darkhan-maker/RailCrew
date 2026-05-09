import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTripDto, TripQuery, TripSchema, TripListResponse } from '@railcrew/contracts';
import { PrismaService } from '../prisma/prisma.service';

const segmentInclude = { segments: { orderBy: { order: 'asc' as const } } };

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTripDto) {
    const { segments, ...tripData } = dto;
    const trip = await this.prisma.trip.create({
      data: {
        ...tripData,
        userId,
        syncedAt: new Date(),
        ...(segments?.length ? { segments: { createMany: { data: segments } } } : {}),
      },
      include: segmentInclude,
    });
    return TripSchema.parse(trip as unknown);
  }

  async findAll(userId: string, query: TripQuery): Promise<TripListResponse> {
    const where: Record<string, unknown> = {
      userId,
      ...(query.from && { date: { gte: query.from } }),
      ...(query.to && { date: { lte: query.to } }),
      ...(query.tripType && { tripType: query.tripType }),
      ...(query.status && { status: query.status }),
      ...(query.routeFrom && { routeFrom: { contains: query.routeFrom, mode: 'insensitive' } }),
      ...(query.routeTo && { routeTo: { contains: query.routeTo, mode: 'insensitive' } }),
      ...(query.search && {
        OR: [
          { routeFrom: { contains: query.search, mode: 'insensitive' } },
          { routeTo: { contains: query.search, mode: 'insensitive' } },
          { trainNumber: { contains: query.search, mode: 'insensitive' } },
          { locoModel: { contains: query.search, mode: 'insensitive' } },
          { locoNumber: { contains: query.search, mode: 'insensitive' } },
          { notes: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: segmentInclude,
      }),
      this.prisma.trip.count({ where }),
    ]);

    return { items: items.map((t: unknown) => TripSchema.parse(t)), total };
  }

  async findOne(userId: string, id: string) {
    const trip = await this.prisma.trip.findFirst({
      where: { id, userId },
      include: segmentInclude,
    });
    if (!trip) throw new NotFoundException('Поездка не найдена');
    return TripSchema.parse(trip as unknown);
  }

  async update(userId: string, id: string, dto: Partial<CreateTripDto>) {
    await this.findOne(userId, id);
    const { segments, ...tripData } = dto;
    const updated = await this.prisma.trip.update({
      where: { id },
      data: {
        ...tripData,
        ...(segments !== undefined ? {
          segments: {
            deleteMany: {},
            ...(segments.length > 0 ? { createMany: { data: segments } } : {}),
          },
        } : {}),
      },
      include: segmentInclude,
    });
    return TripSchema.parse(updated as unknown);
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.trip.delete({ where: { id } });
  }

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
