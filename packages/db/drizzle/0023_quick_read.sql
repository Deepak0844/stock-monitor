ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_schedule_interval";--> statement-breakpoint
ALTER TABLE "stock_observations" ADD COLUMN "read_by" text;--> statement-breakpoint
ALTER TABLE "stock_observations" ADD CONSTRAINT "stock_observations_read_by" CHECK ("stock_observations"."read_by" is null or "stock_observations"."read_by" in ('quick', 'browser'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_schedule_interval" CHECK ("suppliers"."schedule_interval_minutes" is null or "suppliers"."schedule_interval_minutes" in (15, 30, 60, 180, 360, 720, 1440));