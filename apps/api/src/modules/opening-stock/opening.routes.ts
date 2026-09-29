import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { dateString, idParam, openingStockSchema, reverseSchema } from '@inventory/shared';
import { wrap } from '../../lib/async';
import { fromDbDate } from '../../lib/dates';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { reverse } from '../inventory/inventory.service';
import { buildTemplate, createOpeningStock, parseOpeningWorkbook } from './opening.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const upload = express.raw({ type: [XLSX, 'application/octet-stream'], limit: '5mb' });
const dateQuery = z.object({ date: dateString });
const idemKey = (h: string | string[] | undefined) => {
  const v = Array.isArray(h) ? h[0] : h;
  if (v && v.length > 100) throw badRequest('Idempotency-Key too long');
  return v || undefined;
};

const serialize = (t: {
  id: string;
  txnNo: string;
  txnDate: Date;
  remarks: string | null;
  createdAt: Date;
  lines: {
    itemId: string;
    warehouseId: string;
    qtyIn: { toString(): string };
    batchNo: string | null;
    unitCost?: { toString(): string } | null;
  }[];
}) => ({
  id: t.id,
  txnNo: t.txnNo,
  txnDate: fromDbDate(t.txnDate),
  remarks: t.remarks,
  createdAt: t.createdAt,
  lines: t.lines.map((l) => ({
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    qty: l.qtyIn.toString(),
    unitCost: l.unitCost?.toString() ?? null,
    batchNo: l.batchNo,
  })),
});

export const openingRouter = Router();
openingRouter.use(authenticate);

openingRouter.get(
  '/',
  wrap(async (_req, res) => {
    const txns = await prisma.inventoryTransaction.findMany({
      where: { type: 'OPENING_STOCK' },
      include: {
        lines: {
          include: {
            item: { select: { code: true, name: true } },
            warehouse: { select: { code: true } },
          },
        },
        reversedBy: { select: { txnNo: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(
      txns.map((t) => ({
        ...serialize(t),
        user: t.createdBy.name,
        reversedBy: t.reversedBy?.txnNo ?? null,
        lines: t.lines.map((l) => ({
          itemCode: l.item.code,
          itemName: l.item.name,
          warehouse: l.warehouse.code,
          qty: l.qtyIn.toString(),
          batchNo: l.batchNo,
        })),
      })),
    );
  }),
);

openingRouter.get(
  '/template',
  wrap(async (_req, res) => {
    res
      .type(XLSX)
      .set('Content-Disposition', 'attachment; filename="opening-stock-template.xlsx"')
      .send(await buildTemplate());
  }),
);

// Opening dates are usually in the past, so entry is restricted to roles allowed to backdate.
const writers = requireRole('ADMIN', 'MANAGER');

openingRouter.post(
  '/',
  writers,
  validate(openingStockSchema),
  wrap(async (req, res) => {
    const txn = await createOpeningStock(
      req.body,
      req.user!.id,
      idemKey(req.headers['idempotency-key']),
    );
    res.status(201).json(serialize(txn));
  }),
);

openingRouter.post(
  '/import/preview',
  writers,
  validate(dateQuery, 'query'),
  upload,
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
      throw badRequest('Upload an .xlsx file');
    res.json((await parseOpeningWorkbook(req.body)).preview);
  }),
);

/** Re-parses and re-validates the file; nothing is written unless every row is valid. */
openingRouter.post(
  '/import/confirm',
  writers,
  validate(dateQuery, 'query'),
  upload,
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
      throw badRequest('Upload an .xlsx file');
    const date = (req.query as { date: string }).date;
    const key =
      idemKey(req.headers['idempotency-key']) ??
      `opening-import:${createHash('sha256').update(req.body).digest('hex')}:${date}`;
    // A retry/double-click of an already-committed import returns the original result, before
    // re-validation would (correctly) flag its rows as "already exists".
    const prior = await prisma.inventoryTransaction.findUnique({
      where: { idempotencyKey: key },
      include: { lines: true },
    });
    if (prior) return res.status(201).json(serialize(prior));

    const parsed = await parseOpeningWorkbook(req.body);
    if (!parsed.preview.canConfirm) {
      throw new HttpError(
        422,
        'IMPORT_INVALID',
        'Import has row errors; nothing was saved',
        parsed.preview,
      );
    }
    const txn = await createOpeningStock(
      { txnDate: date, remarks: 'Excel import', lines: parsed.lines },
      req.user!.id,
      key,
    );
    res.status(201).json(serialize(txn));
  }),
);

openingRouter.post(
  '/:id/reverse',
  writers,
  validate(idParam, 'params'),
  validate(reverseSchema),
  wrap(async (req, res) => {
    const id = req.params.id as string;
    const orig = await prisma.inventoryTransaction.findUnique({ where: { id } });
    if (!orig) throw notFound('Transaction not found');
    if (orig.type !== 'OPENING_STOCK') throw conflict('Only opening stock can be reversed here');
    const rev = await reverse(id, req.body.reason, req.user!.id);
    res.status(201).json(serialize(rev));
  }),
);
