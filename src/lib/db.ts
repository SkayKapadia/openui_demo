import "server-only";
import { Pool } from "pg";

/**
 * One shared pool per server process. DATABASE_URL should point at the
 * read-only `dashboard_reader` role locally, or any Postgres in production.
 */
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    // Hosted Postgres (Neon, Supabase) needs TLS; local Docker doesn't.
    ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

export async function query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}
