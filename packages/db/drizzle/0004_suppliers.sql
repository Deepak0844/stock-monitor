CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website_url" text NOT NULL,
	"login_url" text,
	"check_interval_minutes" integer DEFAULT 60 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"session_status" text DEFAULT 'not_connected' NOT NULL,
	"paused_reason" text,
	"last_session_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_session_status" CHECK ("suppliers"."session_status" in ('not_connected', 'connected', 'needs_reconnect', 'blocked')),
	CONSTRAINT "suppliers_check_interval" CHECK ("suppliers"."check_interval_minutes" between 15 and 1440),
	CONSTRAINT "suppliers_pause_reason" CHECK (("suppliers"."enabled" and "suppliers"."paused_reason" is null) or (not "suppliers"."enabled" and "suppliers"."paused_reason" is not null and "suppliers"."paused_reason" in ('owner', 'session')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_unique" ON "suppliers" USING btree (lower("name"));