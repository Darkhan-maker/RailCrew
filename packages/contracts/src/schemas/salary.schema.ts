import { z } from 'zod';

const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SalaryRuleSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().min(1),
  ratePerHour: z.number().positive(),
  nightCoefficient: z.number().min(1),
  overtimeCoefficient: z.number().min(1),
  overtimeThresholdHours: z.number().positive().default(8),
  tripBonus: z.number().min(0).default(0),
  effectiveFrom: ISODate,
  effectiveTo: ISODate.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  harmfulnessPercent: z.number().min(0).default(0),
  classPercent: z.number().min(0).default(0),
  zonalPercent: z.number().min(0).default(0),
  regionalCoefficient: z.number().min(1).default(1),
  unionPercent: z.number().min(0).default(1),
  taxPercent: z.number().min(0).default(13),
  holidayCoefficient: z.number().min(1).default(2),
  tripBonusPerHour: z.number().min(0).default(0),
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
