CREATE TABLE "page_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"mapping_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"expected_answer" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"page_class" text,
	"description" jsonb,
	"picture" "bytea",
	"kept_reason" text DEFAULT 'example' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_captures_status" CHECK ("page_captures"."status" in ('pending', 'ready', 'failed')),
	CONSTRAINT "page_captures_expected" CHECK ("page_captures"."expected_answer" is null or "page_captures"."expected_answer" in ('in_stock', 'out_of_stock', 'cannot_tell')),
	CONSTRAINT "page_captures_kept" CHECK ("page_captures"."kept_reason" in ('example', 'page_changed'))
);
--> statement-breakpoint
CREATE TABLE "stock_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mapping_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer" text NOT NULL,
	"reason" text,
	"quantity" integer,
	"matched_text" text,
	"quantity_mismatch" boolean DEFAULT false NOT NULL,
	"recipe_version" integer,
	"check_result" text NOT NULL,
	"capture_id" uuid,
	CONSTRAINT "stock_observations_answer" CHECK ("stock_observations"."answer" in ('in_stock', 'out_of_stock', 'cannot_tell'))
);
--> statement-breakpoint
CREATE TABLE "stock_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_reason";--> statement-breakpoint
ALTER TABLE "mappings" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "default_region" text;--> statement-breakpoint
ALTER TABLE "page_captures" ADD CONSTRAINT "page_captures_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_captures" ADD CONSTRAINT "page_captures_mapping_id_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_observations" ADD CONSTRAINT "stock_observations_mapping_id_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_observations" ADD CONSTRAINT "stock_observations_capture_id_page_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."page_captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipes" ADD CONSTRAINT "stock_recipes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_captures_supplier_idx" ON "page_captures" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_observations_mapping_idx" ON "stock_observations" USING btree ("mapping_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_recipes_supplier_version" ON "stock_recipes" USING btree ("supplier_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_recipes_one_active" ON "stock_recipes" USING btree ("supplier_id") WHERE "stock_recipes"."active";--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_region" CHECK ("mappings"."region" is null or char_length("mappings"."region") between 1 and 200);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind" CHECK ("notifications"."kind" in ('supplier_needs_reconnect', 'recipe_needs_review'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reason" CHECK ("notifications"."reason" in ('login_required', 'captcha', 'blocked', 'unknown', 'page_changed'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_default_region" CHECK ("suppliers"."default_region" is null or char_length("suppliers"."default_region") between 1 and 200);--> statement-breakpoint
-- Observations are append only: the app may add rows and read them, never change or delete them. A link or supplier delete
-- still removes them, because a foreign key cascade runs as the table's owner.
REVOKE UPDATE, DELETE ON stock_observations FROM app_user;
