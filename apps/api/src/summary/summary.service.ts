import { Injectable } from '@nestjs/common';
import { Summary, SummaryQuery, RouteStatSchema } from '@railcrew/contracts';
import { TripsService } from '../trips/trips.service';
import { SalaryService } from '../salary/salary.service';

@Injectable()
export class SummaryService {
  constructor(
    private readonly tripsService: TripsService,
    private readonly salaryService: SalaryService,
  ) {}

  async compute(userId: string, query: SummaryQuery): Promise<Summary> {
    const trips = await this.tripsService.findForPeriod(userId, query.from, query.to);

    const totalMinutes = trips.reduce((sum, t) => sum + t.durationMinutes, 0);

    const routeMap = new Map<string, { count: number; totalMinutes: number }>();
    for (const trip of trips) {
      const key = `${trip.routeFrom}|||${trip.routeTo}`;
      const existing = routeMap.get(key) ?? { count: 0, totalMinutes: 0 };
      routeMap.set(key, {
        count: existing.count + 1,
        totalMinutes: existing.totalMinutes + trip.durationMinutes,
      });
    }

    const routeStats = [...routeMap.entries()].map(([key, val]) => {
      const [routeFrom, routeTo] = key.split('|||');
      return RouteStatSchema.parse({ routeFrom, routeTo, ...val });
    });

    const activeRule = await this.salaryService.findActive(userId, query.to);
    const breakdown = activeRule
      ? this.salaryService.calculate(
          trips.map((t) => ({ durationMinutes: t.durationMinutes, startTime: t.startTime })),
          activeRule,
        )
      : null;

    return {
      periodType: query.periodType,
      from: query.from,
      to: query.to,
      totalTrips: trips.length,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      routeStats,
      estimatedSalary: breakdown?.total ?? null,
      salaryBreakdown: breakdown,
    };
  }
}
