import { z } from 'zod';

const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PeriodTypeSchema = z.enum(['DAY', 'WEEK', 'MONTH', 'CUSTOM']);
export type PeriodType = z.infer<typeof PeriodTypeSchema>;

export const SummaryQuerySchema = z.object({
  periodType: PeriodTypeSchema,
  from: ISODate,
  to: ISODate,
});
export type SummaryQuery = z.infer<typeof SummaryQuerySchema>;

export const RouteStatSchema = z.object({
  routeFrom: z.string(),
  routeTo: z.string(),
  count: z.number().int(),
  totalMinutes: z.number().int(),
});
export type RouteStat = z.infer<typeof RouteStatSchema>;

export const SalaryBreakdownSchema = z.object({
  baseAmount: z.number(),
  overtimeAmount: z.number(),
  nightAmount: z.number(),
  tripBonuses: z.number(),
  total: z.number(),
});
export type SalaryBreakdown = z.infer<typeof SalaryBreakdownSchema>;

export const SummarySchema = z.object({
  periodType: PeriodTypeSchema,
  from: z.string(),
  to: z.string(),
  totalTrips: z.number().int(),
  totalMinutes: z.number().int(),
  totalHours: z.number(),
  routeStats: z.array(RouteStatSchema),
  estimatedSalary: z.number().nullable(),
  salaryBreakdown: SalaryBreakdownSchema.nullable(),
});
export type Summary = z.infer<typeof SummarySchema>;
