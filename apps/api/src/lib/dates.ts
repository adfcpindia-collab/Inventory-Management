import { env } from './env';

/** Today's business date (YYYY-MM-DD) in the company timezone. */
export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.COMPANY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** DATE columns are read/written as UTC-midnight instants. */
export const toDbDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
