import { z } from 'zod';

export const TripTypeSchema = z.enum(['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN']);
export type TripType = z.infer<typeof TripTypeSchema>;

export const TripTypeLabelMap: Record<TripType, string> = {
  FREIGHT: 'Грузовой',
  PASSENGER: 'Пассажирский',
  SHUNTING: 'Маневровый',
  DEAD_RUN: 'Резервом',
};

export const TripStatusSchema = z.enum(['DRAFT', 'CONFIRMED']);
export type TripStatus = z.infer<typeof TripStatusSchema>;

// ISO date string YYYY-MM-DD
const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты: YYYY-MM-DD');
// Time string HH:mm
const HHmm = z.string().regex(/^\d{2}:\d{2}$/, 'Формат времени: HH:mm');

export const TripSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  routeFrom: z.string().min(1),
  routeTo: z.string().min(1),
  date: ISODate,
  endDate: ISODate.nullish(),
  startTime: HHmm,
  endTime: HHmm,
  durationMinutes: z.number().int().positive(),
  tripType: TripTypeSchema,
  status: TripStatusSchema,
  notes: z.string().nullish(),
  localId: z.string().nullish(),
  syncedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // Work-cycle fields — persisted on server
  trainNumber: z.string().nullish(),
  trainWeight: z.number().nullish(),
  axleCount: z.number().int().nullish(),
  locoModel: z.string().nullish(),
  locoNumber: z.string().nullish(),
  appearanceDate: ISODate.nullish(),
  appearanceTime: HHmm.nullish(),
  handoverDate: ISODate.nullish(),
  handoverTime: HHmm.nullish(),
  sectionCount: z.number().int().nullish(),
});
export type Trip = z.infer<typeof TripSchema>;

export const CreateTripDtoSchema = z.object({
  routeFrom: z.string().min(1),
  routeTo: z.string().min(1),
  date: ISODate,
  endDate: ISODate.optional(),
  startTime: HHmm,
  endTime: HHmm,
  durationMinutes: z.number().int().positive(),
  tripType: TripTypeSchema,
  status: TripStatusSchema.default('CONFIRMED'),
  notes: z.string().optional(),
  localId: z.string().optional(),
  // Work-cycle fields — stable, persisted on server
  trainNumber: z.string().optional(),
  trainWeight: z.number().optional(),
  axleCount: z.number().int().optional(),
  locoModel: z.string().optional(),
  locoNumber: z.string().optional(),
  appearanceDate: ISODate.optional(),
  appearanceTime: HHmm.optional(),
  handoverDate: ISODate.optional(),
  handoverTime: HHmm.optional(),
  sectionCount: z.number().int().optional(),
});
export type CreateTripDto = z.infer<typeof CreateTripDtoSchema>;

export const UpdateTripDtoSchema = CreateTripDtoSchema.partial();
export type UpdateTripDto = z.infer<typeof UpdateTripDtoSchema>;

export const TripListResponseSchema = z.object({
  items: z.array(TripSchema),
  total: z.number().int(),
});
export type TripListResponse = z.infer<typeof TripListResponseSchema>;

export const TripQuerySchema = z.object({
  from: ISODate.optional(),
  to: ISODate.optional(),
  tripType: TripTypeSchema.optional(),
  status: TripStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type TripQuery = z.infer<typeof TripQuerySchema>;
