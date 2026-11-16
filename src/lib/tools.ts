import { tool } from "ai";
import { z } from "zod";
import { generateDashboard } from "./dashboard-generator";
import { query } from "./db";

/**
 * Data tools the model can call. Each runs a fixed, parameterised SQL query
 * against Postgres. The model never writes SQL, and the DB role is read-only.
 */

// Models are sloppy with arguments, so accept "ind", "IND" or ["IND"] and "2000" or 2000.
const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const asArray = (v: unknown) => (typeof v === "string" ? [v] : v);
const indicatorCode = z.preprocess(upper, z.string().regex(/^[A-Z0-9.]{3,40}$/, "World Bank indicator code"));
const countryCode = z.preprocess(upper, z.string().regex(/^[A-Z]{3}$/, "ISO3 country code"));
const indicatorList = (max: number) => z.preprocess(asArray, z.array(indicatorCode).min(1).max(max));
const countryList = z.preprocess(asArray, z.array(countryCode).min(1).max(8)).default(["IND"]);
const year = z.coerce.number().int().min(1960).max(2100);

type IndicatorRow = {
  code: string;
  name: string;
  topic: string;
  unit: string | null;
  first_year: number | null;
  last_year: number | null;
};

const dataTools = {
  list_catalog: tool({
    description:
      "List every country and indicator in the database, with each indicator's topic, unit and year range. Call this first to find the right codes.",
    inputSchema: z.object({}),
    execute: async () => {
      const [countries, indicators] = await Promise.all([
        query<{ code: string; name: string; region: string | null }>(
          "SELECT code, name, region FROM countries ORDER BY code = 'IND' DESC, name",
        ),
        query<IndicatorRow>(
          `SELECT i.code, i.name, i.topic, i.unit,
                  min(o.year) AS first_year, max(o.year) AS last_year
             FROM indicators i
             LEFT JOIN observations o ON o.indicator_code = i.code
            GROUP BY i.code
            ORDER BY i.topic, i.name`,
        ),
      ]);
      return { source: "World Bank World Development Indicators", countries, indicators };
    },
  }),

  get_indicator_series: tool({
    description:
      "Yearly values for up to 8 indicators and up to 8 countries. Returns one series per indicator. `labels` holds the years as strings and `datasets` holds one value array per country (null where data is missing), ready for LineChart or BarChart.",
    inputSchema: z.object({
      indicators: indicatorList(8),
      countries: countryList,
      startYear: year.default(2000),
      endYear: year.optional(),
    }),
    execute: async ({ indicators, countries, startYear, endYear }) => {
      const rows = await query<{
        indicator_code: string;
        country_code: string;
        year: number;
        value: number;
      }>(
        `SELECT indicator_code, country_code, year, value
           FROM observations
          WHERE indicator_code = ANY($1) AND country_code = ANY($2)
            AND year >= $3 AND ($4::int IS NULL OR year <= $4)
          ORDER BY year`,
        [indicators, countries, startYear, endYear ?? null],
      );
      const meta = await query<{ code: string; name: string; unit: string | null }>(
        "SELECT code, name, unit FROM indicators WHERE code = ANY($1)",
        [indicators],
      );

      return {
        countries,
        series: meta.map((m) => {
          const own = rows.filter((r) => r.indicator_code === m.code);
          const years = [...new Set(own.map((r) => r.year))].sort((a, b) => a - b);
          const value = new Map(own.map((r) => [`${r.country_code}:${r.year}`, r.value]));
          return {
            indicator: m.code,
            name: m.name,
            unit: m.unit,
            // Chart labels must be strings, e.g. "2000", not 2000.
            labels: years.map(String),
            // Missing years are null (a gap), never 0.
            datasets: countries.map((c) => ({
              country: c,
              values: years.map((y) => {
                const v = value.get(`${c}:${y}`);
                return v === undefined ? null : Number(v.toPrecision(4));
              }),
            })),
          };
        }),
      };
    },
  }),

  get_latest_snapshot: tool({
    description:
      "The most recent value of every indicator for the given countries, plus the value 10 years earlier for context. Good for KPI cards and comparison tables.",
    inputSchema: z.object({
      countries: countryList,
      topic: z.enum(["Economy", "People", "Infrastructure", "Environment"]).optional(),
    }),
    execute: async ({ countries, topic }) => {
      const rows = await query(
        `WITH latest AS (
           SELECT DISTINCT ON (o.country_code, o.indicator_code)
                  o.country_code, o.indicator_code, o.year, o.value
             FROM observations o
            WHERE o.country_code = ANY($1)
            ORDER BY o.country_code, o.indicator_code, o.year DESC
         )
         SELECT l.country_code, c.name AS country, i.topic, l.indicator_code, i.name AS indicator,
                i.unit, l.year, l.value,
                prev.year AS year_10y_earlier, prev.value AS value_10y_earlier
           FROM latest l
           JOIN countries c ON c.code = l.country_code
           JOIN indicators i ON i.code = l.indicator_code
           LEFT JOIN observations prev
             ON prev.country_code = l.country_code
            AND prev.indicator_code = l.indicator_code
            AND prev.year = l.year - 10
          WHERE $2::text IS NULL OR i.topic = $2
          ORDER BY i.topic, i.name, c.name`,
        [countries, topic ?? null],
      );
      return { rows };
    },
  }),
};

/** The chat agent's tools. `origin` is the app's own URL, used to link to saved dashboards. */
export function chatTools(origin: string) {
  return {
    ...dataTools,
    create_dashboard: tool({
      description:
        "Create a saved, live dashboard with filters. It loads its own data from Postgres every time it opens, so describe which data to show and how, without numbers. Returns the dashboard's url.",
      inputSchema: z.object({
        title: z.string().min(1).max(80).describe('A short title, such as "India vs China: economy".'),
        prompt: z
          .string()
          .min(1)
          .describe(
            "What to build: the KPIs, charts, tables and filters, and which indicators and countries each shows. No numbers.",
          ),
      }),
      execute: async ({ title, prompt }, { abortSignal }) => {
        const { dashboard, attempts } = await generateDashboard({ title, prompt, signal: abortSignal });
        return {
          id: dashboard.id,
          title: dashboard.title,
          url: `${origin}/d/${dashboard.id}`,
          attempts,
        };
      },
    }),
  };
}
