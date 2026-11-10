-- pg-boss creates and owns its own "pgboss" schema on first start. This lets the app role do that.
-- It gives no rights on tables owned by the migration role, so audit_events stays append-only.
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO app_user', current_database());
END
$$;
