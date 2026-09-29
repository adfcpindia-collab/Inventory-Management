-- Sequence backing conversions.conversion_no (must exist before the column default).
CREATE SEQUENCE "conversion_no_seq";

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "inventory_transactions" ALTER COLUMN "txn_no" SET DEFAULT ('TXN-' || lpad(nextval('inventory_txn_seq')::text, 8, '0'));

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "conversion_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_template_inputs" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "conversion_template_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_template_outputs" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "conversion_template_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL,
    "conversion_no" TEXT NOT NULL DEFAULT ('CONV-' || lpad(nextval('conversion_no_seq')::text, 6, '0')),
    "txn_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "template_id" UUID,
    "multiplier" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "idempotency_key" TEXT,
    "out_txn_id" UUID,
    "in_txn_id" UUID,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NONE',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_inputs" (
    "id" UUID NOT NULL,
    "conversion_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "conversion_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_outputs" (
    "id" UUID NOT NULL,
    "conversion_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "conversion_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversion_template_inputs_template_id_line_no_key" ON "conversion_template_inputs"("template_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_template_outputs_template_id_line_no_key" ON "conversion_template_outputs"("template_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_conversion_no_key" ON "conversions"("conversion_no");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_idempotency_key_key" ON "conversions"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_out_txn_id_key" ON "conversions"("out_txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_in_txn_id_key" ON "conversions"("in_txn_id");

-- CreateIndex
CREATE INDEX "conversions_txn_date_idx" ON "conversions"("txn_date");

-- CreateIndex
CREATE INDEX "conversions_status_idx" ON "conversions"("status");

-- CreateIndex
CREATE INDEX "conversion_inputs_item_id_idx" ON "conversion_inputs"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_inputs_conversion_id_line_no_key" ON "conversion_inputs"("conversion_id", "line_no");

-- CreateIndex
CREATE INDEX "conversion_outputs_item_id_idx" ON "conversion_outputs"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_outputs_conversion_id_line_no_key" ON "conversion_outputs"("conversion_id", "line_no");

-- AddForeignKey
ALTER TABLE "conversion_templates" ADD CONSTRAINT "conversion_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_template_inputs" ADD CONSTRAINT "conversion_template_inputs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "conversion_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_template_inputs" ADD CONSTRAINT "conversion_template_inputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_template_outputs" ADD CONSTRAINT "conversion_template_outputs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "conversion_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_template_outputs" ADD CONSTRAINT "conversion_template_outputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "conversion_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_out_txn_id_fkey" FOREIGN KEY ("out_txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_in_txn_id_fkey" FOREIGN KEY ("in_txn_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_inputs" ADD CONSTRAINT "conversion_inputs_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "conversions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_inputs" ADD CONSTRAINT "conversion_inputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_inputs" ADD CONSTRAINT "conversion_inputs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_outputs" ADD CONSTRAINT "conversion_outputs_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "conversions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_outputs" ADD CONSTRAINT "conversion_outputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_outputs" ADD CONSTRAINT "conversion_outputs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Conversion integrity
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "conversion_templates_name_lower" ON "conversion_templates" (lower("name"));

ALTER TABLE "conversions"
  ADD CONSTRAINT "conversions_multiplier_pos" CHECK ("multiplier" > 0),
  -- confirmed conversions always point at BOTH ledger transactions
  ADD CONSTRAINT "conversions_confirmed_has_txns" CHECK ("status" <> 'CONFIRMED' OR ("out_txn_id" IS NOT NULL AND "in_txn_id" IS NOT NULL));
ALTER TABLE "conversion_inputs" ADD CONSTRAINT "conversion_inputs_qty_pos" CHECK ("qty" > 0);
ALTER TABLE "conversion_outputs" ADD CONSTRAINT "conversion_outputs_qty_pos" CHECK ("qty" > 0);
ALTER TABLE "conversion_template_inputs" ADD CONSTRAINT "conv_tpl_inputs_qty_pos" CHECK ("qty" > 0);
ALTER TABLE "conversion_template_outputs" ADD CONSTRAINT "conv_tpl_outputs_qty_pos" CHECK ("qty" > 0);
