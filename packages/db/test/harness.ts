import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export type TestDb = {
  url: string;
  pool: pg.Pool;
  db: ReturnType<typeof drizzle>;
  stop: () => Promise<void>;
};

// OrbStack keeps its socket outside /var/run. Point Testcontainers at it when DOCKER_HOST is unset.
const orbstackSocket = `${homedir()}/.orbstack/run/docker.sock`;
if (!process.env.DOCKER_HOST && !existsSync("/var/run/docker.sock") && existsSync(orbstackSocket)) {
  process.env.DOCKER_HOST = `unix://${orbstackSocket}`;
}

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:17-alpine").start();
  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  return {
    url,
    pool,
    db,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
