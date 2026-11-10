CREATE TABLE "check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"links_total" integer DEFAULT 0 NOT NULL,
	"links_done" integer DEFAULT 0 NOT NULL,
	"in_stock" integer DEFAULT 0 NOT NULL,
	"out_of_stock" integer DEFAULT 0 NOT NULL,
	"cannot_tell" integer DEFAULT 0 NOT NULL,
	"outcome" text DEFAULT 'running' NOT NULL,
	"stop_reason" text,
	CONSTRAINT "check_runs_trigger" CHECK ("check_runs"."trigger" in ('scheduled', 'manual')),
	CONSTRAINT "check_runs_outcome" CHECK ("check_runs"."outcome" in ('running', 'finished', 'stopped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "schedule_interval_minutes" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "schedule_window_start" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "schedule_window_end" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_runs_one_running" ON "check_runs" USING btree ("supplier_id") WHERE "check_runs"."outcome" = 'running';--> statement-breakpoint
CREATE INDEX "check_runs_supplier_started" ON "check_runs" USING btree ("supplier_id","started_at");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_schedule_interval" CHECK ("suppliers"."schedule_interval_minutes" is null or "suppliers"."schedule_interval_minutes" in (60, 180, 360, 720, 1440));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_schedule_window" CHECK (("suppliers"."schedule_window_start" is null) = ("suppliers"."schedule_window_end" is null));