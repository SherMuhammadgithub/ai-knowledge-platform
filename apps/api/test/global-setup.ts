import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// Creates the akp_test database on the same Postgres as dev (if missing) and applies migrations.
// Tests only ever use this database. The dev database is never touched.
export const TEST_DB_NAME = "akp_test";

export default async function setup() {
  const rootEnv = resolve(__dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example)");

  const devUrl = new URL(process.env.DATABASE_URL);
  const admin = new pg.Client({ connectionString: devUrl.toString() });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [TEST_DB_NAME]);
  if (!exists.rowCount) await admin.query(`create database ${TEST_DB_NAME}`);
  await admin.end();

  const testUrl = new URL(devUrl);
  testUrl.pathname = `/${TEST_DB_NAME}`;
  process.env.TEST_DATABASE_URL = testUrl.toString();

  execSync("bunx prisma migrate deploy", {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "inherit",
  });
}
