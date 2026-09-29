-- Data-integrity constraints that Prisma cannot express.
ALTER TABLE "items"
  ADD CONSTRAINT "items_levels_nonneg" CHECK ("min_level" >= 0 AND "reorder_level" >= 0 AND "max_level" >= 0),
  ADD CONSTRAINT "items_levels_order" CHECK ("min_level" <= "reorder_level" AND ("max_level" = 0 OR "max_level" >= "reorder_level")),
  ADD CONSTRAINT "items_gst_range" CHECK ("gst_rate" >= 0 AND "gst_rate" <= 100),
  ADD CONSTRAINT "items_prices_nonneg" CHECK ("purchase_price" >= 0 AND "selling_price" >= 0);

-- Exactly one default warehouse at most.
CREATE UNIQUE INDEX "warehouses_single_default" ON "warehouses" ("is_default") WHERE "is_default" = true;

-- Case-insensitive uniqueness for emails and category names.
CREATE UNIQUE INDEX "users_email_lower" ON "users" (lower("email"));
CREATE UNIQUE INDEX "categories_name_lower" ON "categories" (lower("name"));
