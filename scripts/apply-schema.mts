/**
 * Applies db/schema.sql to DATABASE_URL_ADMIN and makes sure the
 * `dashboard_reader` and `dashboard_store` roles exist. Use it for hosted Postgres (e.g. Neon), where
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

const { rows: [{ db: dbName }] } = await db.query("SELECT quote_ident(current_database()) AS db");

/** Create the role, or update its password if it exists. DDL can't take bind
 *  parameters, so Postgres quotes the password itself with format(). */
async function ensureRole(role: string, password: string) {
  const { rows } = await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  const { rows: [{ sql }] } = await db.query(
    "SELECT format('%s ROLE %I LOGIN PASSWORD %L', $1::text, $2::text, $3::text) AS sql",
    [rows.length ? "ALTER" : "CREATE", role, password],
  );
  await db.query(sql);
  await db.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${role}`);
  await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await db.query(`ALTER ROLE ${role} SET statement_timeout = '5s'`);
  console.log(`Role ${role} ${rows.length ? "updated" : "created"}.`);
}

// The role the data tools read with: SELECT only, in read-only transactions.
if (process.env.READER_PASSWORD) {
  await ensureRole("dashboard_reader", process.env.READER_PASSWORD);
  await db.query("GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader");
  await db.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_reader");
  await db.query("ALTER ROLE dashboard_reader SET default_transaction_read_only = on");
} else {
  console.log("READER_PASSWORD not set: skipped the dashboard_reader role.");
}

// The role the app saves dashboards with: it can touch only its own two tables.
if (process.env.STORE_PASSWORD) {
  await ensureRole("dashboard_store", process.env.STORE_PASSWORD);
  await db.query("GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards TO dashboard_store");
  await db.query("GRANT SELECT, INSERT, UPDATE ON chat_usage TO dashboard_store");
} else {
  console.log("STORE_PASSWORD not set: skipped the dashboard_store role.");
}
await db.end();
