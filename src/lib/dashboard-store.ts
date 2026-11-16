import "server-only";
import { randomBytes } from "crypto";
import { Pool } from "pg";

/**
 * Saved dashboards live in the app's own Postgres. This pool uses the
 * `dashboard_store` role, which can touch only the `dashboards` table.
 */
const globalForPg = globalThis as unknown as { pgStorePool?: Pool };

const pool =
  globalForPg.pgStorePool ??
  new Pool({
    connectionString: process.env.DATABASE_URL_STORE,
    max: 3,
    ssl: process.env.DATABASE_URL_STORE?.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgStorePool = pool;

export type Dashboard = {
  id: string;
  title: string;
  prompt: string;
  source: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS = `id, title, prompt, source, model,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function saveDashboard(input: {
  id?: string;
  title: string;
  prompt: string;
  source: string;
  model?: string;
}): Promise<Dashboard> {
  const id = input.id ?? randomBytes(6).toString("base64url");
  const { rows } = await pool.query<Dashboard>(
    `INSERT INTO dashboards (id, title, prompt, source, model) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title, prompt = EXCLUDED.prompt, source = EXCLUDED.source,
           model = EXCLUDED.model, updated_at = now()
     RETURNING ${COLUMNS}`,
    [id, input.title, input.prompt, input.source, input.model ?? null],
  );
  return rows[0];
}

export async function getDashboard(id: string): Promise<Dashboard | null> {
  const { rows } = await pool.query<Dashboard>(`SELECT ${COLUMNS} FROM dashboards WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listDashboards(): Promise<Omit<Dashboard, "source">[]> {
  const { rows } = await pool.query<Dashboard>(
    `SELECT id, title, prompt, model, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM dashboards ORDER BY updated_at DESC LIMIT 100`,
  );
  return rows;
}
