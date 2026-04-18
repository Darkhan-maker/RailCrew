import { z } from 'zod';
import { CreateTripDtoSchema } from './trip.schema';

export const VoiceRecognitionResultSchema = z.object({
  rawText: z.string(),
  parsedFields: CreateTripDtoSchema.partial(),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()).default([]),
});
export type VoiceRecognitionResult = z.infer<typeof VoiceRecognitionResultSchema>;

export const VoiceInputDtoSchema = z.object({
  rawText: z.string().min(1),
});
export type VoiceInputDto = z.infer<typeof VoiceInputDtoSchema>;
