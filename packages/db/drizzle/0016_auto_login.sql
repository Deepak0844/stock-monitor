CREATE TABLE "supplier_credentials" (
	"supplier_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"key_id" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_reason";--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "auto_login" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "stealth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "login_selectors" jsonb;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "auto_login_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "auto_login_paused_reason" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "last_auto_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "last_auto_login_result" text;--> statement-breakpoint
ALTER TABLE "supplier_credentials" ADD CONSTRAINT "supplier_credentials_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reason" CHECK ("notifications"."reason" in ('login_required', 'captcha', 'blocked', 'unknown', 'page_changed', 'code_required', 'wrong_password', 'account_locked', 'form_not_found'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_auto_login_permission" CHECK (not "suppliers"."auto_login" or "suppliers"."automation_permission" = 'granted');--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_stealth_permission" CHECK (not "suppliers"."stealth" or "suppliers"."automation_permission" = 'granted');--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_auto_login_paused_reason" CHECK ("suppliers"."auto_login_paused_reason" is null or "suppliers"."auto_login_paused_reason" in ('wrong_password', 'account_locked', 'too_many_failures'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_last_auto_login_result" CHECK ("suppliers"."last_auto_login_result" is null or "suppliers"."last_auto_login_result" in ('ok', 'captcha', 'code_required', 'wrong_password', 'account_locked', 'blocked', 'form_not_found', 'unreachable', 'unknown'));