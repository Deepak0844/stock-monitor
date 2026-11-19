ALTER TABLE "mappings" ADD COLUMN "supplier_option" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "needs_login" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_supplier_option" CHECK ("mappings"."supplier_option" is null or char_length("mappings"."supplier_option") between 1 and 200);