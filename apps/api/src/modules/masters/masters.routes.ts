import { Router } from 'express';
import {
  categorySchema,
  clientSchema,
  itemSchema,
  supplierSchema,
  unitSchema,
} from '@inventory/shared';
import { unprocessable } from '../../lib/errors';
import { masterRouter } from '../../lib/master';

export const mastersRouter = Router();

mastersRouter.use(
  '/categories',
  masterRouter({
    entity: 'Category',
    delegate: (tx) => tx.category as never,
    schema: categorySchema,
    searchFields: ['name', 'description'],
    orderBy: { name: 'asc' },
  }),
);

mastersRouter.use(
  '/units',
  masterRouter({
    entity: 'Unit',
    delegate: (tx) => tx.unit as never,
    schema: unitSchema,
    searchFields: ['code', 'name'],
    orderBy: { code: 'asc' },
  }),
);

mastersRouter.use(
  '/clients',
  masterRouter({
    entity: 'Client',
    delegate: (tx) => tx.client as never,
    schema: clientSchema,
    searchFields: ['companyName', 'contactPerson', 'phone', 'email', 'gstin'],
    orderBy: { companyName: 'asc' },
  }),
);

mastersRouter.use(
  '/suppliers',
  masterRouter({
    entity: 'Supplier',
    delegate: (tx) => tx.supplier as never,
    schema: supplierSchema,
    searchFields: ['companyName', 'contactPerson', 'phone', 'email', 'gstin'],
    orderBy: { companyName: 'asc' },
  }),
);

mastersRouter.use(
  '/items',
  masterRouter({
    entity: 'Item',
    delegate: (tx) => tx.item as never,
    schema: itemSchema,
    searchFields: ['code', 'name', 'subcategory', 'description', 'hsnSac'],
    orderBy: { name: 'asc' },
    include: { category: true, unit: true },
    beforeWrite: async (tx, data) => {
      const [cat, unit] = await Promise.all([
        tx.category.findUnique({ where: { id: data.categoryId as string } }),
        tx.unit.findUnique({ where: { id: data.unitId as string } }),
      ]);
      if (!cat?.active) throw unprocessable('Category does not exist or is inactive');
      if (!unit?.active) throw unprocessable('Unit does not exist or is inactive');
    },
  }),
);
