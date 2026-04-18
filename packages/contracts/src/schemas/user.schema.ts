import { z } from 'zod';

export const UserRoleSchema = z.enum(['DRIVER', 'ASSISTANT']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  employeeId: z.string().nullable().optional(),
  depot: z.string().nullable().optional(),
  tariffGrade: z.number().int().min(1).max(12).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const RegisterDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: UserRoleSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});
export type RegisterDto = z.infer<typeof RegisterDtoSchema>;

export const LoginDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDtoSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  user: UserSchema,
  profile: ProfileSchema.nullable(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const UpdateProfileDtoSchema = ProfileSchema.pick({
  firstName: true,
  lastName: true,
  employeeId: true,
  depot: true,
  tariffGrade: true,
}).partial();
export type UpdateProfileDto = z.infer<typeof UpdateProfileDtoSchema>;
