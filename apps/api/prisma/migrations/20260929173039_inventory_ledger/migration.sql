-- Sequence backing inventory_transactions.txn_no (must exist before the column default).
CREATE SEQUENCE "inventory_txn_seq";

-- CreateEnum
CREATE TYPE "TxnType" AS ENUM ('OPENING_STOCK', 'PROCUREMENT', 'DISPATCH', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'CONVERSION_IN', 'CONVERSION_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'SCRAP', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('USABLE', 'DAMAGED', 'INSPECTION');

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "txn_no" TEXT NOT NULL DEFAULT ('TXN-' || lpad(nextval('inventory_txn_seq')::text, 8, '0')),
    "type" "TxnType" NOT NULL,
    "txn_date" DATE NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "reference_no" TEXT,
    "client_id" UUID,
    "supplier_id" UUID,
    "group_id" TEXT,
    "reverses_txn_id" UUID,
    "idempotency_key" TEXT,
    "remarks" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transaction_items" (
    "id" UUID NOT NULL,
    "txn_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "stock_status" "StockStatus" NOT NULL DEFAULT 'USABLE',
    "qty_in" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "qty_out" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,2),
    "batch_no" TEXT,
    "serial_no" TEXT,
    "mfg_date" DATE,
    "expiry_date" DATE,

    CONSTRAINT "inventory_transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "stock_status" "StockStatus" NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("item_id","warehouse_id","stock_status")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_txn_no_key" ON "inventory_transactions"("txn_no");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_reverses_txn_id_key" ON "inventory_transactions"("reverses_txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_idempotency_key_key" ON "inventory_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "inventory_transactions_txn_date_idx" ON "inventory_transactions"("txn_date");

-- CreateIndex
CREATE INDEX "inventory_transactions_type_txn_date_idx" ON "inventory_transactions"("type", "txn_date");

-- CreateIndex
CREATE INDEX "inventory_transactions_reference_no_idx" ON "inventory_transactions"("reference_no");

-- CreateIndex
CREATE INDEX "inventory_transactions_group_id_idx" ON "inventory_transactions"("group_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_client_id_idx" ON "inventory_transactions"("client_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_supplier_id_idx" ON "inventory_transactions"("supplier_id");

-- CreateIndex
CREATE INDEX "inventory_transaction_items_item_id_warehouse_id_stock_stat_idx" ON "inventory_transaction_items"("item_id", "warehouse_id", "stock_status");

-- CreateIndex
CREATE INDEX "inventory_transaction_items_batch_no_idx" ON "inventory_transaction_items"("batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transaction_items_txn_id_line_no_key" ON "inventory_transaction_items"("txn_id", "line_no");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reverses_txn_id_fkey" FOREIGN KEY ("reverses_txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction_items" ADD CONSTRAINT "inventory_transaction_items_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction_items" ADD CONSTRAINT "inventory_transaction_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction_items" ADD CONSTRAINT "inventory_transaction_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Ledger integrity (CLAUDE.md rules 1-4)
-- ---------------------------------------------------------------------------
ALTER TABLE "inventory_transaction_items"
  ADD CONSTRAINT "txn_items_qty_nonneg" CHECK ("qty_in" >= 0 AND "qty_out" >= 0),
  -- exactly one direction per line, never zero
  ADD CONSTRAINT "txn_items_one_direction" CHECK (("qty_in" > 0 AND "qty_out" = 0) OR ("qty_in" = 0 AND "qty_out" > 0)),
  ADD CONSTRAINT "txn_items_cost_nonneg" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

-- Negative stock is impossible even if the service layer is bypassed.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_nonneg" CHECK ("qty" >= 0);

-- A transaction can be reversed at most once (also enforced by the unique index on reverses_txn_id)
-- and only REVERSAL rows may reference another transaction.
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "txn_reversal_link" CHECK (("type" = 'REVERSAL') = ("reverses_txn_id" IS NOT NULL));

-- Confirmed ledger rows are append-only: corrections are new REVERSAL transactions.
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (use a reversal transaction)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inventory_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_transactions"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER "inventory_transaction_items_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_transaction_items"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
