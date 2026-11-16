/**
 * Loads World Bank WDI indicators into Postgres.
 *
 *   npm run load:worldbank
 *
 * Idempotent: every row is upserted, so re-running refreshes the data.
 * Connects with DATABASE_URL_ADMIN (write access); the app itself only reads.
 */
import pg from "pg";
import { COUNTRIES, INDICATORS, START_YEAR } from "./worldbank-catalog.mts";

const API = "https://api.worldbank.org/v2";

type WbMeta = { page: number; pages: number; total: number; lastupdated?: string };
type WbObs = {
  indicator: { id: string; value: string };
  country: { id: string; value: string };
  countryiso3code: string;
  date: string;
  value: number | null;
};

async function getJson<T>(url: string, attempt = 1): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return getJson<T>(url, attempt + 1);
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return (await res.json()) as T;
}

/** The API answers errors with HTTP 200 and a `[{ message: [...] }]` body. */
function apiError(body: unknown): string | null {
  if (Array.isArray(body) && body.length === 1 && body[0]?.message) {
    return JSON.stringify(body[0].message);
  }
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set (see .env.example)");
  const db = new pg.Client({ connectionString: url });
  await db.connect();

  const run = await db.query<{ id: number }>(
    "INSERT INTO load_runs (source) VALUES ('worldbank') RETURNING id",
  );
  const endYear = new Date().getFullYear();
  let total = 0;
  const skipped: string[] = [];

  // Countries: names, regions and income groups.
  const [, countryRows] = await getJson<[WbMeta, Array<{
    id: string; name: string; region: { value: string }; incomeLevel: { value: string };
  }>]>(`${API}/country/${COUNTRIES.join(";")}?format=json&per_page=100`);
  for (const c of countryRows) {
    await db.query(
      `INSERT INTO countries (code, name, region, income) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region, income = EXCLUDED.income`,
      [c.id, c.name, c.region?.value?.trim() || null, c.incomeLevel?.value?.trim() || null],
    );
  }
  console.log(`countries: ${countryRows.length}`);

  for (const ind of INDICATORS) {
    const metaBody = await getJson<unknown>(`${API}/indicator/${ind.code}?format=json`);
    const err = apiError(metaBody);
    if (err) {
      skipped.push(`${ind.code} (${err})`);
      continue;
    }
    const meta = (metaBody as [WbMeta, Array<{ name: string; sourceNote?: string }>])[1][0];

    await db.query(
      `INSERT INTO indicators (code, name, topic, unit, description) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, topic = EXCLUDED.topic,
         unit = EXCLUDED.unit, description = EXCLUDED.description`,
      [ind.code, meta.name, ind.topic, ind.unit, meta.sourceNote ?? null],
    );

    const dataUrl =
      `${API}/country/${COUNTRIES.join(";")}/indicator/${ind.code}` +
      `?format=json&per_page=20000&date=${START_YEAR}:${endYear}`;
    const body = await getJson<[WbMeta, WbObs[] | null]>(dataUrl);
    const rows = (body[1] ?? []).filter((o) => o.value !== null && o.countryiso3code);

    if (rows.length) {
      // One multi-row upsert per indicator.
      const values: unknown[] = [];
      const tuples = rows.map((o, i) => {
        values.push(o.countryiso3code, ind.code, Number(o.date), o.value);
        const b = i * 4;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
      });
      await db.query(
        `INSERT INTO observations (country_code, indicator_code, year, value) VALUES ${tuples.join(",")}
         ON CONFLICT (country_code, indicator_code, year) DO UPDATE SET value = EXCLUDED.value`,
        values,
      );
    }
    total += rows.length;
    console.log(`${ind.code.padEnd(22)} ${String(rows.length).padStart(4)} rows  ${meta.name}`);
  }

  await db.query(
    "UPDATE load_runs SET finished_at = now(), rows_upserted = $2, notes = $3 WHERE id = $1",
    [run.rows[0].id, total, skipped.length ? `skipped: ${skipped.join("; ")}` : null],
  );
  await db.end();

  console.log(`\nDone: ${total} observations upserted.`);
  if (skipped.length) console.warn(`Skipped: ${skipped.join("; ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
