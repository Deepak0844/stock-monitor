import { setupDatabase } from "./setup.js";

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
};

setupDatabase({
  ownerUrl: need("MIGRATION_DATABASE_URL"),
  appRole: process.env.APP_DB_USER ?? "stock_app",
  appPassword: need("APP_DB_PASSWORD"),
})
  .then(() => console.log("Database is up to date."))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "Database setup failed.");
    process.exit(1);
  });
