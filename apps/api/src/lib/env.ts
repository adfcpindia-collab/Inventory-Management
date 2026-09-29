import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  COMPANY_NAME: z.string().default('Your Company'),
  COMPANY_TIMEZONE: z.string().default('Asia/Kolkata'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
