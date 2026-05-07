import { z } from 'zod';

export const TripTypeSchema = z.enum(['FREIGHT', 'PASSENGER', 'SHUNTING', 'DEAD_RUN']);
export type TripType = z.infer<typeof TripTypeSchema>;

export const AppearanceTypeSchema = z.enum(['HOME', 'TURNAROUND']);
export type AppearanceType = z.infer<typeof AppearanceTypeSchema>;

export const AppearanceTypeLabelMap: Record<AppearanceType, string> = {
  HOME: 'Явка из дома',
  TURNAROUND: 'Явка из пункта оборота',
};

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
  conditionalLength: z.number().int().nonnegative().nullish(),
  locoModel: z.string().nullish(),
  locoNumber: z.string().nullish(),
  appearanceDate: ISODate.nullish(),
  appearanceTime: HHmm.nullish(),
  handoverDate: ISODate.nullish(),
  handoverTime: HHmm.nullish(),
  sectionCount: z.number().int().nullish(),
  isPassenger: z.boolean().nullish(),
  energy1Start: z.number().nullish(),
  energy1End: z.number().nullish(),
  energy1Consumption: z.number().nullish(),
  energy2Start: z.number().nullish(),
  energy2End: z.number().nullish(),
  energy2Consumption: z.number().nullish(),
  energy3Start: z.number().nullish(),
  energy3End: z.number().nullish(),
  energy3Consumption: z.number().nullish(),
  appearanceType: AppearanceTypeSchema.nullish(),
  lunchBreakMinutes: z.number().int().nullish(),
  recuperation1Accepted: z.number().nullish(),
  recuperation1Delivered: z.number().nullish(),
  recuperation2Accepted: z.number().nullish(),
  recuperation2Delivered: z.number().nullish(),
  recuperation3Accepted: z.number().nullish(),
  recuperation3Delivered: z.number().nullish(),
  checkpointOut: HHmm.nullish(),
  checkpointIn: HHmm.nullish(),
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
  conditionalLength: z.number().int().nonnegative().optional(),
  locoModel: z.string().optional(),
  locoNumber: z.string().optional(),
  appearanceDate: ISODate.optional(),
  appearanceTime: HHmm.optional(),
  handoverDate: ISODate.optional(),
  handoverTime: HHmm.optional(),
  sectionCount: z.number().int().optional(),
  isPassenger: z.boolean().optional(),
  energy1Start: z.number().optional(),
  energy1End: z.number().optional(),
  energy1Consumption: z.number().optional(),
  energy2Start: z.number().optional(),
  energy2End: z.number().optional(),
  energy2Consumption: z.number().optional(),
  energy3Start: z.number().optional(),
  energy3End: z.number().optional(),
  energy3Consumption: z.number().optional(),
  appearanceType: AppearanceTypeSchema.optional(),
  lunchBreakMinutes: z.number().int().optional(),
  recuperation1Accepted: z.number().optional(),
  recuperation1Delivered: z.number().optional(),
  recuperation2Accepted: z.number().optional(),
  recuperation2Delivered: z.number().optional(),
  recuperation3Accepted: z.number().optional(),
  recuperation3Delivered: z.number().optional(),
  checkpointOut: HHmm.optional(),
  checkpointIn: HHmm.optional(),
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
  search: z.string().optional(),
  routeFrom: z.string().optional(),
  routeTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type TripQuery = z.infer<typeof TripQuerySchema>;
