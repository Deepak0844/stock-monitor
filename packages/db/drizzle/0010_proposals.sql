CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" text NOT NULL,
	"mapping_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"observation_id" bigint,
	"kind" text NOT NULL,
	"shopify_quantity_seen" integer NOT NULL,
	"proposed_quantity" integer NOT NULL,
	"approved_quantity" integer,
	"edited" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"note" text,
	"closed_reason" text,
	"idempotency_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"applied_at" timestamp with time zone,
	"result_code" text,
	"result_quantity" integer,
	CONSTRAINT "proposals_state" CHECK ("proposals"."state" in ('open', 'approved', 'applied', 'conflict', 'failed', 'rejected', 'expired', 'replaced')),
	CONSTRAINT "proposals_kind" CHECK ("proposals"."kind" in ('set_zero_out_of_stock', 'set_zero_not_listed', 'set_zero_page_missing', 'restock')),
	CONSTRAINT "proposals_quantities" CHECK ("proposals"."proposed_quantity" >= 0 and ("proposals"."approved_quantity" is null or "proposals"."approved_quantity" >= 0))
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_variant_id_shopify_variants_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."shopify_variants"("variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_mapping_id_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_observation_id_stock_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."stock_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_one_live_per_variant" ON "proposals" USING btree ("variant_id") WHERE "proposals"."state" in ('open', 'approved');--> statement-breakpoint
CREATE INDEX "proposals_state_created" ON "proposals" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "proposals_supplier_idx" ON "proposals" USING btree ("supplier_id");