import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Role } from '@inventory/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

export const app = createApp();
export const PASSWORD = 'Sup3r-secret-pw';

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_logs, refresh_tokens, items, categories, units, clients, suppliers, warehouses, users CASCADE',
  );
}

export async function createUser(role: Role, email = `${role.toLowerCase()}@test.com`) {
  return prisma.user.create({
    data: { email, name: `${role} user`, role, passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
}

export async function tokenFor(role: Role) {
  const email = `${role.toLowerCase()}@test.com`;
  if (!(await prisma.user.findUnique({ where: { email } }))) await createUser(role);
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.accessToken as string;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function seedRefData() {
  const category = await prisma.category.create({ data: { name: 'Finished Goods' } });
  const unit = await prisma.unit.create({ data: { code: 'KG', name: 'Kilogram' } });
  return { category, unit };
}

export const itemPayload = (categoryId: string, unitId: string, over: object = {}) => ({
  code: 'abc-9kg',
  name: 'ABC 9 KG',
  categoryId,
  unitId,
  productType: 'FINISHED_GOOD',
  minLevel: 5,
  reorderLevel: 10,
  maxLevel: 100,
  hsnSac: '8424',
  gstRate: 18,
  purchasePrice: 100,
  sellingPrice: 150,
  ...over,
});
