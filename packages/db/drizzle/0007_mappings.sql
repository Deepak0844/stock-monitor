CREATE TABLE "import_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"url" text NOT NULL,
	"note" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"link_status" text DEFAULT 'not_checked' NOT NULL,
	"last_link_check_at" timestamp with time zone,
	"last_worked_at" timestamp with time zone,
	"worked_title" text,
	"worked_heading" text,
	"missing_checks" integer DEFAULT 0 NOT NULL,
	"first_missing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mappings_link_status" CHECK ("mappings"."link_status" in ('not_checked', 'works', 'never_worked', 'page_missing', 'moved', 'looks_different', 'needs_login', 'could_not_check'))
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "automation_permission" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "permission_note" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "permission_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "check_pause_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_variant_id_shopify_variants_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."shopify_variants"("variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mappings_variant_supplier_unique" ON "mappings" USING btree ("variant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "mappings_supplier_idx" ON "mappings" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_automation_permission" CHECK ("suppliers"."automation_permission" in ('unknown', 'granted', 'not_granted'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_check_pause" CHECK ("suppliers"."check_pause_seconds" >= 1);