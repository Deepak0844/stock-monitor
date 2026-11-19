ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
-- Notices already open on the day this ships were seen on the Dashboard: never email them.
UPDATE "notifications" SET "emailed_at" = now() WHERE "resolved_at" IS NULL;
