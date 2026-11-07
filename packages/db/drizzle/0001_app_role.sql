DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users, app_sessions, app_settings TO app_user;--> statement-breakpoint
-- audit_events is append-only for the app: no UPDATE, DELETE or TRUNCATE.
GRANT SELECT, INSERT ON audit_events TO app_user;--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_events_id_seq TO app_user;--> statement-breakpoint
-- Tables added by later migrations are usable by the app role. Revoke explicitly for append-only ones.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
