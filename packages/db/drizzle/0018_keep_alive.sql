ALTER TABLE "suppliers" ADD COLUMN "keep_alive_minutes" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "keep_alive_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_keep_alive" CHECK ("suppliers"."keep_alive_minutes" is null or "suppliers"."keep_alive_minutes" in (15, 30, 45, 60, 120));