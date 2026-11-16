/**
 * Applies db/schema.sql to DATABASE_URL_ADMIN and makes sure the
 * `dashboard_store` role exists. Use it for hosted Postgres (e.g. Neon), where
 * the Docker init script doesn't run, and to upgrade an existing local volume.
 * Safe to run more than once.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) throw new Error("DATABASE_URL_ADMIN is not set (see .env.example)");
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf-8"));
console.log("Schema applied.");

// The role the app saves dashboards with: it can touch only that one table.
const storePw = process.env.STORE_PASSWORD;
if (storePw) {
  const { rows } = await db.query("SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_store'");
  // DDL can't take bind parameters, so let Postgres quote the password itself.
  const verb = rows.length ? "ALTER" : "CREATE";
  const { rows: [{ sql }] } = await db.query(
    "SELECT format('%s ROLE dashboard_store LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
    [verb, storePw],
  );
  await db.query(sql);
  const { rows: [{ db: dbName }] } = await db.query("SELECT quote_ident(current_database()) AS db");
  await db.query(`GRANT CONNECT ON DATABASE ${dbName} TO dashboard_store`);
  await db.query("GRANT USAGE ON SCHEMA public TO dashboard_store");
  await db.query("GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards TO dashboard_store");
  await db.query("ALTER ROLE dashboard_store SET statement_timeout = '5s'");
  console.log(`Role dashboard_store ${rows.length ? "updated" : "created"}.`);
} else {
  console.log("STORE_PASSWORD not set: skipped the dashboard_store role.");
}
await db.end();
