import "server-only";
import type { ToolSpec } from "@openuidev/lang-core";
import { query } from "./db";

/**
 * Data tools for live dashboards.
 *
 * A saved dashboard calls these from the browser through /api/tools every time
 * it opens or a filter changes. No LLM is involved. Each tool runs fixed,
 * parameterised SQL with the read-only Postgres role, and returns a flat shape
 * that OpenUI Lang can bind directly (for example `gdp.labels`, `gdp.values`).
 */

export type DataTool = {
  description: string;
  /** JSON Schema for the arguments, shown to the model. */
  inputSchema: Record<string, unknown>;
  /** A realistic example result. The model reads it to bind components to fields. */
  example: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

// --- Lenient argument reading --------------------------------------------
// An unpicked filter arrives as "" or null. Treat that as "not set" and clamp
// numbers instead of rejecting them, so a dashboard never breaks on a filter.

const unset = (v: unknown) => v === undefined || v === null || v === "";

function code(v: unknown, pattern: RegExp, fallback: string): string {
  if (unset(v)) return fallback;
  const s = String(v).trim().toUpperCase();
  return pattern.test(s) ? s : fallback;
}

function codes(v: unknown, pattern: RegExp, fallback: string[], max = 8): string[] {
  if (unset(v)) return fallback;
  const list = (Array.isArray(v) ? v : String(v).split(","))
    .map((x) => String(x).trim().toUpperCase())
    .filter((x) => pattern.test(x));
  return list.length ? [...new Set(list)].slice(0, max) : fallback;
}

function year(v: unknown, fallback: number): number {
  if (unset(v)) return fallback;
  // A slider binds a number[]; take its first value.
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? Math.min(2100, Math.max(1960, Math.round(n))) : fallback;
}

const COUNTRY = /^[A-Z]{3}$/;
const INDICATOR = /^[A-Z0-9.]{3,40}$/;
const round = (v: number) => Number(v.toPrecision(5));

type Obs = { year: number; value: number };

async function indicatorMeta(indicator: string) {
  const [m] = await query<{ code: string; name: string; unit: string | null; topic: string }>(
    "SELECT code, name, unit, topic FROM indicators WHERE code = $1",
    [indicator],
  );
  return m ?? { code: indicator, name: indicator, unit: null, topic: "" };
}

async function countryName(c: string) {
  const [row] = await query<{ name: string }>("SELECT name FROM countries WHERE code = $1", [c]);
  return row?.name ?? c;
}

export const dataTools: Record<string, DataTool> = {
  get_series: {
    description:
      "Yearly values of ONE indicator for ONE country. `labels` (years as strings) and `values` are aligned and cover every year from startYear to endYear, with null where there is no data. Call it once per country to compare countries on one chart: the labels line up when startYear and endYear match.",
    inputSchema: {
      type: "object",
      properties: {
        indicator: { type: "string", description: "Indicator code, e.g. NY.GDP.PCAP.CD" },
        country: { type: "string", description: "ISO3 country code, e.g. IND. Default IND." },
        startYear: { type: "number", description: "First year, 1960 or later. Default 2000." },
        endYear: { type: "number", description: "Last year. Leave it out to get the latest year with data (recommended)." },
      },
      required: ["indicator"],
    },
    example: {
      indicator: "NY.GDP.PCAP.CD",
      name: "GDP per capita (current US$)",
      unit: "current US$",
      country: "IND",
      countryName: "India",
      labels: ["2022", "2023", "2024", "2025"],
      values: [2353, 2481, 2592, 2702],
      latestYear: "2025",
      latestValue: 2702,
      firstYear: "2022",
      firstValue: 2353,
      changePct: 14.8,
    },
    execute: async (args) => {
      const indicator = code(args.indicator, INDICATOR, "NY.GDP.PCAP.CD");
      const country = code(args.country, COUNTRY, "IND");
      const start = year(args.startYear, 2000);
      const [{ max }] = await query<{ max: number | null }>(
        "SELECT max(year) FROM observations WHERE indicator_code = $1",
        [indicator],
      );
      // Never run past the indicator's last year with data: OpenUI charts draw a
      // trailing null as 0 (thesysdev/openui#1611), which looks like a crash to zero.
      const lastWithData = max ?? new Date().getFullYear();
      const end = Math.max(start, Math.min(year(args.endYear, lastWithData), lastWithData));

      const [meta, name, rows] = await Promise.all([
        indicatorMeta(indicator),
        countryName(country),
        query<Obs>(
          `SELECT year, value FROM observations
            WHERE indicator_code = $1 AND country_code = $2 AND year BETWEEN $3 AND $4
            ORDER BY year`,
          [indicator, country, start, end],
        ),
      ]);

      const byYear = new Map(rows.map((r) => [r.year, r.value]));
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      const first = rows[0];
      const latest = rows[rows.length - 1];
      return {
        indicator,
        name: meta.name,
        unit: meta.unit,
        country,
        countryName: name,
        labels: years.map(String),
        values: years.map((y) => (byYear.has(y) ? round(byYear.get(y)!) : null)),
        latestYear: latest ? String(latest.year) : null,
        latestValue: latest ? round(latest.value) : null,
        firstYear: first ? String(first.year) : null,
        firstValue: first ? round(first.value) : null,
        changePct:
          first && latest && first.value !== 0
            ? Number((((latest.value - first.value) / Math.abs(first.value)) * 100).toFixed(1))
            : null,
      };
    },
  },

  get_comparison: {
    description:
      "ONE indicator across several countries for a single year: one row per country, sorted from highest to lowest. Without `year`, each country's most recent value is used. Good for a bar chart or ranking table.",
    inputSchema: {
      type: "object",
      properties: {
        indicator: { type: "string", description: "Indicator code" },
        countries: {
          type: "array",
          items: { type: "string" },
          description: "ISO3 codes. Default: every country in the database.",
        },
        year: { type: "number", description: "A specific year. Default: latest available per country." },
      },
      required: ["indicator"],
    },
    example: {
      indicator: "SP.DYN.LE00.IN",
      name: "Life expectancy at birth, total (years)",
      unit: "years",
      rows: [
        { country: "CHN", countryName: "China", year: "2024", value: 78.2 },
        { country: "IND", countryName: "India", year: "2024", value: 72.5 },
      ],
    },
    execute: async (args) => {
      const indicator = code(args.indicator, INDICATOR, "NY.GDP.PCAP.CD");
      const all = (await query<{ code: string }>("SELECT code FROM countries")).map((c) => c.code);
      const countries = codes(args.countries, COUNTRY, all);
      const at = unset(args.year) ? null : year(args.year, 2020);

      const [meta, rows] = await Promise.all([
        indicatorMeta(indicator),
        query<{ country_code: string; name: string; year: number; value: number }>(
          `SELECT DISTINCT ON (o.country_code) o.country_code, c.name, o.year, o.value
             FROM observations o JOIN countries c ON c.code = o.country_code
            WHERE o.indicator_code = $1 AND o.country_code = ANY($2)
              AND ($3::int IS NULL OR o.year = $3)
            ORDER BY o.country_code, o.year DESC`,
          [indicator, countries, at],
        ),
      ]);
      return {
        indicator,
        name: meta.name,
        unit: meta.unit,
        rows: rows
          .sort((a, b) => b.value - a.value)
          .map((r) => ({
            country: r.country_code,
            countryName: r.name,
            year: String(r.year),
            value: round(r.value),
          })),
      };
    },
  },

  get_snapshot: {
    description:
      "The most recent value of every indicator for ONE country, with the value 10 years earlier and the change. One row per indicator. Good for a summary table. Optional `topic` narrows it.",
    inputSchema: {
      type: "object",
      properties: {
        country: { type: "string", description: "ISO3 country code. Default IND." },
        topic: {
          type: "string",
          enum: ["Economy", "People", "Infrastructure", "Environment"],
          description: "Optional topic filter. Empty means all topics.",
        },
      },
    },
    example: {
      country: "IND",
      countryName: "India",
      rows: [
        {
          indicator: "IT.NET.USER.ZS",
          name: "Individuals using the Internet (% of population)",
          topic: "Infrastructure",
          unit: "% of population",
          year: "2025",
          value: 70,
          value10yEarlier: 14.9,
          changePct: 369.8,
        },
      ],
    },
    execute: async (args) => {
      const country = code(args.country, COUNTRY, "IND");
      const topics = ["Economy", "People", "Infrastructure", "Environment"];
      const topic = topics.find((t) => t.toLowerCase() === String(args.topic ?? "").toLowerCase()) ?? null;

      const [name, rows] = await Promise.all([
        countryName(country),
        query<{
          indicator_code: string;
          name: string;
          topic: string;
          unit: string | null;
          year: number;
          value: number;
          prev: number | null;
        }>(
          `WITH latest AS (
             SELECT DISTINCT ON (indicator_code) indicator_code, year, value
               FROM observations WHERE country_code = $1
              ORDER BY indicator_code, year DESC
           )
           SELECT l.indicator_code, i.name, i.topic, i.unit, l.year, l.value, p.value AS prev
             FROM latest l
             JOIN indicators i ON i.code = l.indicator_code
             LEFT JOIN observations p
               ON p.country_code = $1 AND p.indicator_code = l.indicator_code AND p.year = l.year - 10
            WHERE $2::text IS NULL OR i.topic = $2
            ORDER BY i.topic, i.name`,
          [country, topic],
        ),
      ]);
      return {
        country,
        countryName: name,
        rows: rows.map((r) => ({
          indicator: r.indicator_code,
          name: r.name,
          topic: r.topic,
          unit: r.unit,
          year: String(r.year),
          value: round(r.value),
          value10yEarlier: r.prev === null ? null : round(r.prev),
          changePct:
            r.prev === null || r.prev === 0
              ? null
              : Number((((r.value - r.prev) / Math.abs(r.prev)) * 100).toFixed(1)),
        })),
      };
    },
  },
};

/** Tool descriptions in the shape OpenUI's prompt generator expects. */
export function toolSpecs(): ToolSpec[] {
  return Object.entries(dataTools).map(([name, t]) => ({
    name,
    description: `${t.description}\nExample result: ${JSON.stringify(t.example)}`,
    inputSchema: t.inputSchema,
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  }));
}
