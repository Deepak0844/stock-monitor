CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"message" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "notifications_kind" CHECK ("notifications"."kind" in ('supplier_needs_reconnect')),
	CONSTRAINT "notifications_reason" CHECK ("notifications"."reason" in ('login_required', 'captcha', 'blocked', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_one_open" ON "notifications" USING btree ("kind","supplier_id") WHERE "notifications"."resolved_at" is null;