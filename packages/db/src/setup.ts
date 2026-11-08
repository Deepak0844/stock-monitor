import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Run as the database owner. Applies migrations, then creates (or updates the password of) the
 * login role the API and worker connect as. That role belongs to `app_user`, which cannot change
 * or delete audit events. Safe to run on every deploy.
 */
export async function setupDatabase(opts: {
  ownerUrl: string;
  appRole: string;
  appPassword: string;
}): Promise<void> {
  if (!ROLE_NAME.test(opts.appRole)) {
    throw new Error("Invalid role name: use lowercase letters, digits and underscores.");
  }
  const pool = new pg.Pool({ connectionString: opts.ownerUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });

    // format() quotes the name and the password, so neither can break out of the statement.
    const exists = (await pool.query("select 1 from pg_roles where rolname = $1", [opts.appRole]))
      .rowCount;
    const template = exists
      ? "ALTER ROLE %I LOGIN PASSWORD %L"
      : "CREATE ROLE %I LOGIN PASSWORD %L";
    const { rows } = await pool.query("select format($1::text, $2::text, $3::text) as sql", [
      template,
      opts.appRole,
      opts.appPassword,
    ]);
    await pool.query(rows[0].sql as string);
    const grant = await pool.query("select format('GRANT app_user TO %I', $1::text) as sql", [
      opts.appRole,
    ]);
    await pool.query(grant.rows[0].sql as string);
  } finally {
    await pool.end();
  }
}
