-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "inventory_transactions" ALTER COLUMN "txn_no" SET DEFAULT ('TXN-' || lpad(nextval('inventory_txn_seq')::text, 8, '0'));

-- CreateTable
CREATE TABLE "procurements" (
    "id" UUID NOT NULL,
    "grn_no" TEXT NOT NULL,
    "txn_date" DATE NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "idempotency_key" TEXT,
    "txn_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_items" (
    "id" UUID NOT NULL,
    "procurement_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "batch_no" TEXT,

    CONSTRAINT "procurement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatches" (
    "id" UUID NOT NULL,
    "challan_no" TEXT NOT NULL,
    "txn_date" DATE NOT NULL,
    "client_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "address" TEXT,
    "vehicle_no" TEXT,
    "driver_name" TEXT,
    "sales_order_no" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "idempotency_key" TEXT,
    "txn_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_items" (
    "id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,2),
    "amount" DECIMAL(18,2),

    CONSTRAINT "dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "procurements_grn_no_key" ON "procurements"("grn_no");

-- CreateIndex
CREATE UNIQUE INDEX "procurements_idempotency_key_key" ON "procurements"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "procurements_txn_id_key" ON "procurements"("txn_id");

-- CreateIndex
CREATE INDEX "procurements_txn_date_idx" ON "procurements"("txn_date");

-- CreateIndex
CREATE INDEX "procurements_supplier_id_idx" ON "procurements"("supplier_id");

-- CreateIndex
CREATE INDEX "procurements_status_idx" ON "procurements"("status");

-- CreateIndex
CREATE INDEX "procurement_items_item_id_idx" ON "procurement_items"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_items_procurement_id_line_no_key" ON "procurement_items"("procurement_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "dispatches_challan_no_key" ON "dispatches"("challan_no");

-- CreateIndex
CREATE UNIQUE INDEX "dispatches_idempotency_key_key" ON "dispatches"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "dispatches_txn_id_key" ON "dispatches"("txn_id");

-- CreateIndex
CREATE INDEX "dispatches_txn_date_idx" ON "dispatches"("txn_date");

-- CreateIndex
CREATE INDEX "dispatches_client_id_idx" ON "dispatches"("client_id");

-- CreateIndex
CREATE INDEX "dispatches_status_idx" ON "dispatches"("status");

-- CreateIndex
CREATE INDEX "dispatch_items_item_id_idx" ON "dispatch_items"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_items_dispatch_id_line_no_key" ON "dispatch_items"("dispatch_id", "line_no");

-- AddForeignKey
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_procurement_id_fkey" FOREIGN KEY ("procurement_id") REFERENCES "procurements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Document integrity
-- ---------------------------------------------------------------------------
-- GRN / challan numbers are unique regardless of case or surrounding spaces
-- (the plain unique indexes above already cover exact matches).
CREATE UNIQUE INDEX "procurements_grn_no_lower" ON "procurements" (lower("grn_no"));
CREATE UNIQUE INDEX "dispatches_challan_no_lower" ON "dispatches" (lower("challan_no"));

ALTER TABLE "procurements"
  ADD CONSTRAINT "procurements_grn_no_nonblank" CHECK (length(btrim("grn_no")) > 0),
  -- a CONFIRMED document always points at its ledger transaction
  ADD CONSTRAINT "procurements_confirmed_has_txn" CHECK ("status" <> 'CONFIRMED' OR "txn_id" IS NOT NULL);
ALTER TABLE "dispatches"
  ADD CONSTRAINT "dispatches_challan_no_nonblank" CHECK (length(btrim("challan_no")) > 0),
  ADD CONSTRAINT "dispatches_confirmed_has_txn" CHECK ("status" <> 'CONFIRMED' OR "txn_id" IS NOT NULL);

ALTER TABLE "procurement_items"
  ADD CONSTRAINT "procurement_items_qty_pos" CHECK ("qty" > 0),
  ADD CONSTRAINT "procurement_items_money_nonneg" CHECK ("rate" >= 0 AND "amount" >= 0 AND "gst_rate" >= 0 AND "gst_rate" <= 100);
ALTER TABLE "dispatch_items"
  ADD CONSTRAINT "dispatch_items_qty_pos" CHECK ("qty" > 0),
  ADD CONSTRAINT "dispatch_items_money_nonneg" CHECK (("rate" IS NULL OR "rate" >= 0) AND ("amount" IS NULL OR "amount" >= 0));
