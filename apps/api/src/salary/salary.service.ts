import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateSalaryRuleDto,
  SalaryRule,
  SalaryRuleSchema,
  SalaryBreakdown,
} from '@railcrew/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface TripData {
  durationMinutes: number;
  startTime: string;
}

@Injectable()
export class SalaryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSalaryRuleDto): Promise<SalaryRule> {
    const rule = await this.prisma.salaryRule.create({ data: { ...dto, userId } });
    return SalaryRuleSchema.parse(rule);
  }

  async findAll(userId: string): Promise<SalaryRule[]> {
    const rules = await this.prisma.salaryRule.findMany({
      where: { userId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rules.map((r: unknown) => SalaryRuleSchema.parse(r));
  }

  async findActive(userId: string, date: string): Promise<SalaryRule | null> {
    const rule = await this.prisma.salaryRule.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rule ? SalaryRuleSchema.parse(rule) : null;
  }

  async update(userId: string, id: string, dto: Partial<CreateSalaryRuleDto>): Promise<SalaryRule> {
    const existing = await this.prisma.salaryRule.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Правило не найдено');
    const updated = await this.prisma.salaryRule.update({ where: { id }, data: dto });
    return SalaryRuleSchema.parse(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.salaryRule.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Правило не найдено');
    await this.prisma.salaryRule.delete({ where: { id } });
  }

  /**
   * Считает зарплату по списку поездок и правилу.
   * Расширяемо: добавить коэффициент за тип поездки, регион, выходные.
   */
  calculate(trips: TripData[], rule: SalaryRule): SalaryBreakdown {
    let baseMinutes = 0;
    let overtimeMinutes = 0;
    let nightMinutes = 0;

    for (const trip of trips) {
      const dur = trip.durationMinutes;
      const thresholdMins = rule.overtimeThresholdHours * 60;

      if (dur > thresholdMins) {
        baseMinutes += thresholdMins;
        overtimeMinutes += dur - thresholdMins;
      } else {
        baseMinutes += dur;
      }

      // Ночные часы с 22:00 до 06:00
      const [sh, sm] = trip.startTime.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = startMins + dur;
      nightMinutes += this.calcNightMinutes(startMins, endMins);
    }

    const rph = rule.ratePerHour / 60; // тенге/минута
    const baseAmount = baseMinutes * rph;
    const overtimeAmount = overtimeMinutes * rph * rule.overtimeCoefficient;
    const nightAmount = nightMinutes * rph * (rule.nightCoefficient - 1);
    const tripBonuses = trips.length * rule.tripBonus;

    return {
      baseAmount: Math.round(baseAmount),
      overtimeAmount: Math.round(overtimeAmount),
      nightAmount: Math.round(nightAmount),
      tripBonuses: Math.round(tripBonuses),
      total: Math.round(baseAmount + overtimeAmount + nightAmount + tripBonuses),
    };
  }

  private calcNightMinutes(startMins: number, endMins: number): number {
    // Ночное окно: 22:00 (1320) до 06:00 следующего дня (1800 = 30*60)
    const NIGHT_START = 22 * 60;
    const NIGHT_END = 6 * 60 + 24 * 60; // 06:00 следующего дня в минутах от полуночи
    let night = 0;
    const s = startMins;
    const e = endMins;
    // 22:00 - 00:00
    const n1s = NIGHT_START, n1e = 24 * 60;
    night += Math.max(0, Math.min(e, n1e) - Math.max(s, n1s));
    // 00:00 - 06:00
    const n2s = 0, n2e = 6 * 60;
    const es = e % (24 * 60), ss2 = s < 24 * 60 ? 0 : s - 24 * 60;
    if (e > 24 * 60) {
      night += Math.max(0, Math.min(es, n2e) - Math.max(ss2, n2s));
    }
    return Math.max(0, night);
  }
}
