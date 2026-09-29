import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Rebuilds the throwaway test database from empty by replaying every migration.
 * Refuses to touch any database whose name does not end in `_test`.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://inv:inv@localhost:5432/inventory_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${dbName}"`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await prisma.$disconnect();
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
