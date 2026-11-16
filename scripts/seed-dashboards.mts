/**
 * Saves the hand-written sample dashboards in db/seed/ to Postgres.
 *
 *   npm run db:seed
 *
 * They show the mechanism without any LLM: OpenUI Lang with Query() calls,
 * stored once, loading fresh data every time they open.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const SAMPLES = [
  {
    id: "country-profile",
    title: "Country profile",
    prompt: "Hand-written sample: a country profile with country and start-year filters.",
    file: "country-profile.openui",
  },
];

const url = process.env.DATABASE_URL_STORE;
if (!url) throw new Error("DATABASE_URL_STORE is not set (see .env.example)");
const db = new pg.Client({ connectionString: url });
await db.connect();
for (const s of SAMPLES) {
  const source = readFileSync(new URL(`../db/seed/${s.file}`, import.meta.url), "utf-8");
  await db.query(
    `INSERT INTO dashboards (id, title, prompt, source, model) VALUES ($1, $2, $3, $4, 'hand-written')
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, prompt = EXCLUDED.prompt,
       source = EXCLUDED.source, updated_at = now()`,
    [s.id, s.title, s.prompt, source],
  );
  console.log(`saved /d/${s.id}`);
}
await db.end();
