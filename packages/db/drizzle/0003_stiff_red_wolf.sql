CREATE TABLE "shopify_connection" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"shop" text NOT NULL,
	"credential_type" text NOT NULL,
	"credentials_ciphertext" text NOT NULL,
	"credentials_iv" text NOT NULL,
	"credentials_tag" text NOT NULL,
	"credentials_key_id" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"location_id" text,
	"location_name" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_successful_call_at" timestamp with time zone,
	CONSTRAINT "shopify_connection_single_row" CHECK ("shopify_connection"."id" = true),
	CONSTRAINT "shopify_connection_status" CHECK ("shopify_connection"."status" in ('connected', 'needs_reconnect')),
	CONSTRAINT "shopify_connection_credential_type" CHECK ("shopify_connection"."credential_type" in ('client_credentials', 'static_token'))
);
--> statement-breakpoint
CREATE TABLE "shopify_sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"added" integer,
	"updated" integer,
	"unchanged" integer,
	"removed" integer,
	"total" integer,
	"error" text,
	CONSTRAINT "shopify_sync_runs_status" CHECK ("shopify_sync_runs"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "shopify_variants" (
	"variant_id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"product_title" text NOT NULL,
	"variant_title" text NOT NULL,
	"options" jsonb NOT NULL,
	"sku" text,
	"inventory_item_id" text NOT NULL,
	"tracked" boolean NOT NULL,
	"inventory_policy" text NOT NULL,
	"available" integer,
	"quantity_read_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "shopify_variants_policy" CHECK ("shopify_variants"."inventory_policy" in ('DENY', 'CONTINUE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_sync_one_running" ON "shopify_sync_runs" USING btree ("status") WHERE "shopify_sync_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "shopify_variants_product_idx" ON "shopify_variants" USING btree ("product_id");