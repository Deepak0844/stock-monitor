ALTER TABLE "suppliers" ADD COLUMN "shopify_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_match_name_unique" ON "suppliers" USING btree (lower(coalesce("shopify_name", "name")));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shopify_name" CHECK ("suppliers"."shopify_name" is null or char_length("suppliers"."shopify_name") between 1 and 200);