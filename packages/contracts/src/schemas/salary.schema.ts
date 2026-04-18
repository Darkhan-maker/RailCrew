import { z } from 'zod';

const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SalaryRuleSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().min(1),
  ratePerHour: z.number().positive(),           // тариф, тенге/час
  nightCoefficient: z.number().min(1),           // коэф. за ночные часы (с 22:00 до 06:00)
  overtimeCoefficient: z.number().min(1),        // коэф. за сверхурочные
  overtimeThresholdHours: z.number().positive().default(8),
  tripBonus: z.number().min(0).default(0),       // бонус за каждую поездку, тенге
  effectiveFrom: ISODate,
  effectiveTo: ISODate.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SalaryRule = z.infer<typeof SalaryRuleSchema>;

export const CreateSalaryRuleDtoSchema = SalaryRuleSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateSalaryRuleDto = z.infer<typeof CreateSalaryRuleDtoSchema>;

export const UpdateSalaryRuleDtoSchema = CreateSalaryRuleDtoSchema.partial();
export type UpdateSalaryRuleDto = z.infer<typeof UpdateSalaryRuleDtoSchema>;
