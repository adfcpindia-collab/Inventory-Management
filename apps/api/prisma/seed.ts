import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const UNITS = [
  ['NOS', 'Numbers'],
  ['KG', 'Kilogram'],
  ['LTR', 'Litre'],
  ['MTR', 'Metre'],
  ['SET', 'Set'],
  ['BOX', 'Box'],
  ['PCS', 'Pieces'],
] as const;
const CATEGORIES = [
  'Finished Goods',
  'Empty Body',
  'Raw Material',
  'Component',
  'Packaging',
  'Spare',
  'Other',
];

/** Idempotent reference data (units, categories, default warehouse) + first ADMIN. Not DEMO data. */
async function main() {
  for (const [code, name] of UNITS) {
    await prisma.unit.upsert({ where: { code }, update: {}, create: { code, name } });
  }
  for (const name of CATEGORIES) {
    const exists = await prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (!exists) await prisma.category.create({ data: { name } });
  }
  await prisma.warehouse.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { code: 'MAIN', name: 'Main Warehouse', isDefault: true },
  });

  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; skipping admin user.');
    return;
  }
  if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        name: 'Administrator',
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    console.log(`Created ADMIN ${email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
