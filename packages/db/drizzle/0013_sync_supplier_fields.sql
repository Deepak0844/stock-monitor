ALTER TABLE "shopify_sync_runs" ADD COLUMN "links" jsonb;--> statement-breakpoint
ALTER TABLE "shopify_variants" ADD COLUMN "supplier_name" text;--> statement-breakpoint
ALTER TABLE "shopify_variants" ADD COLUMN "supplier_url" text;