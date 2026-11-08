CREATE TABLE "login_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'starting' NOT NULL,
	"started_by" uuid,
	"browser_session_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"token_used_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "login_sessions_status" CHECK ("login_sessions"."status" in ('starting', 'ready', 'connected', 'saving', 'finished', 'cancelled', 'expired', 'failed')),
	CONSTRAINT "login_sessions_failure_reason" CHECK ("login_sessions"."failure_reason" is null or "login_sessions"."failure_reason" in ('browser_unavailable', 'window_failed', 'window_already_open', 'read_failed', 'save_failed'))
);
--> statement-breakpoint
CREATE TABLE "supplier_sessions" (
	"supplier_id" uuid PRIMARY KEY NOT NULL,
	"state_ciphertext" text NOT NULL,
	"state_iv" text NOT NULL,
	"state_tag" text NOT NULL,
	"state_key_id" text NOT NULL,
	"cookie_count" integer NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"size_bytes" integer NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_sessions" ADD CONSTRAINT "supplier_sessions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "login_sessions_one_open" ON "login_sessions" USING btree ((true)) WHERE "login_sessions"."status" in ('starting', 'ready', 'connected', 'saving');