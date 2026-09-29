import { z } from 'zod';
import { ROLES } from './enums';
import { requiredText } from './common';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

const password = z.string().min(10, 'At least 10 characters').max(200);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: requiredText(100),
  password,
  role: z.enum(ROLES),
});
export const updateUserSchema = z
  .object({
    name: requiredText(100),
    password,
    role: z.enum(ROLES),
    active: z.boolean(),
  })
  .partial();

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: (typeof ROLES)[number];
}
