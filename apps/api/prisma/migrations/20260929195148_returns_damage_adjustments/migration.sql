-- Sequences backing stock_actions.action_no and stock_adjustments.adjustment_no (must exist before the defaults).
CREATE SEQUENCE "stock_action_no_seq";
CREATE SEQUENCE "stock_adjustment_no_seq";

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'DAMAGED', 'NEEDS_INSPECTION');

-- CreateEnum
CREATE TYPE "StockActionType" AS ENUM ('DAMAGE', 'SCRAP', 'REPAIR');

-- AlterTable
ALTER TABLE "conversions" ALTER COLUMN "conversion_no" SET DEFAULT ('CONV-' || lpad(nextval('conversion_no_seq')::text, 6, '0'));

-- AlterTable
ALTER TABLE "inventory_transactions" ALTER COLUMN "txn_no" SET DEFAULT ('TXN-' || lpad(nextval('inventory_txn_seq')::text, 8, '0'));

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" UUID NOT NULL,
    "return_no" TEXT NOT NULL,
    "txn_date" DATE NOT NULL,
    "client_id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
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

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_items" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "reason" TEXT,

    CONSTRAINT "customer_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "return_no" TEXT NOT NULL,
    "txn_date" DATE NOT NULL,
    "supplier_id" UUID NOT NULL,
    "procurement_id" UUID NOT NULL,
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

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_items" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "stock_status" "StockStatus" NOT NULL DEFAULT 'USABLE',
    "reason" TEXT,

    CONSTRAINT "supplier_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_actions" (
    "id" UUID NOT NULL,
    "action_no" TEXT NOT NULL DEFAULT ('DMG-' || lpad(nextval('stock_action_no_seq')::text, 6, '0')),
    "action" "StockActionType" NOT NULL,
    "txn_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "idempotency_key" TEXT,
    "txn_id" UUID,
    "pair_txn_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "adjustment_no" TEXT NOT NULL DEFAULT ('ADJ-' || lpad(nextval('stock_adjustment_no_seq')::text, 6, '0')),
    "txn_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "stock_status" "StockStatus" NOT NULL DEFAULT 'USABLE',
    "system_qty" DECIMAL(18,3) NOT NULL,
    "physical_qty" DECIMAL(18,3) NOT NULL,
    "difference" DECIMAL(18,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NONE',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
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

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_return_no_key" ON "customer_returns"("return_no");

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_idempotency_key_key" ON "customer_returns"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_txn_id_key" ON "customer_returns"("txn_id");

-- CreateIndex
CREATE INDEX "customer_returns_txn_date_idx" ON "customer_returns"("txn_date");

-- CreateIndex
CREATE INDEX "customer_returns_dispatch_id_idx" ON "customer_returns"("dispatch_id");

-- CreateIndex
CREATE INDEX "customer_returns_status_idx" ON "customer_returns"("status");

-- CreateIndex
CREATE INDEX "customer_return_items_item_id_idx" ON "customer_return_items"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_return_items_return_id_line_no_key" ON "customer_return_items"("return_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_return_no_key" ON "supplier_returns"("return_no");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_idempotency_key_key" ON "supplier_returns"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_txn_id_key" ON "supplier_returns"("txn_id");

-- CreateIndex
CREATE INDEX "supplier_returns_txn_date_idx" ON "supplier_returns"("txn_date");

-- CreateIndex
CREATE INDEX "supplier_returns_procurement_id_idx" ON "supplier_returns"("procurement_id");

-- CreateIndex
CREATE INDEX "supplier_returns_status_idx" ON "supplier_returns"("status");

-- CreateIndex
CREATE INDEX "supplier_return_items_item_id_idx" ON "supplier_return_items"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_return_items_return_id_line_no_key" ON "supplier_return_items"("return_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_actions_action_no_key" ON "stock_actions"("action_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_actions_idempotency_key_key" ON "stock_actions"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_actions_txn_id_key" ON "stock_actions"("txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_actions_pair_txn_id_key" ON "stock_actions"("pair_txn_id");

-- CreateIndex
CREATE INDEX "stock_actions_txn_date_idx" ON "stock_actions"("txn_date");

-- CreateIndex
CREATE INDEX "stock_actions_status_idx" ON "stock_actions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_adjustment_no_key" ON "stock_adjustments"("adjustment_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_idempotency_key_key" ON "stock_adjustments"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_txn_id_key" ON "stock_adjustments"("txn_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_txn_date_idx" ON "stock_adjustments"("txn_date");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_idx" ON "stock_adjustments"("status");

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "customer_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_procurement_id_fkey" FOREIGN KEY ("procurement_id") REFERENCES "procurements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_actions" ADD CONSTRAINT "stock_actions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_actions" ADD CONSTRAINT "stock_actions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_actions" ADD CONSTRAINT "stock_actions_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_actions" ADD CONSTRAINT "stock_actions_pair_txn_id_fkey" FOREIGN KEY ("pair_txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_actions" ADD CONSTRAINT "stock_actions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business-rule constraints (defence in depth behind the service layer).
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_bucket" CHECK ("stock_status" IN ('USABLE', 'DAMAGED'));
ALTER TABLE "stock_actions" ADD CONSTRAINT "stock_actions_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_qty_valid" CHECK ("system_qty" >= 0 AND "physical_qty" >= 0);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_difference" CHECK ("difference" <> 0 AND "difference" = "physical_qty" - "system_qty");
-- Return numbers are unique case-insensitively, like GRN / challan numbers.
CREATE UNIQUE INDEX "customer_returns_return_no_lower_key" ON "customer_returns" (lower("return_no"));
CREATE UNIQUE INDEX "supplier_returns_return_no_lower_key" ON "supplier_returns" (lower("return_no"));
ALTER TABLE "customer_returns"
  ADD CONSTRAINT "customer_returns_no_nonblank" CHECK (length(btrim("return_no")) > 0),
  ADD CONSTRAINT "customer_returns_confirmed_has_txn" CHECK ("status" <> 'CONFIRMED' OR "txn_id" IS NOT NULL);
ALTER TABLE "supplier_returns"
  ADD CONSTRAINT "supplier_returns_no_nonblank" CHECK (length(btrim("return_no")) > 0),
  ADD CONSTRAINT "supplier_returns_confirmed_has_txn" CHECK ("status" <> 'CONFIRMED' OR "txn_id" IS NOT NULL);
ALTER TABLE "stock_actions"
  ADD CONSTRAINT "stock_actions_reason_nonblank" CHECK (length(btrim("reason")) > 0),
  ADD CONSTRAINT "stock_actions_confirmed_has_txn" CHECK ("status" <> 'CONFIRMED' OR "txn_id" IS NOT NULL);
-- An adjustment reaches the ledger only after a manager approved it.
ALTER TABLE "stock_adjustments"
  ADD CONSTRAINT "stock_adjustments_reason_nonblank" CHECK (length(btrim("reason")) > 0),
  ADD CONSTRAINT "stock_adjustments_confirmed_approved" CHECK ("status" <> 'CONFIRMED' OR ("txn_id" IS NOT NULL AND "approval_status" = 'APPROVED' AND "approved_by_id" IS NOT NULL));
