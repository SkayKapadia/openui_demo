import { generateSystemPrompt, type LibrarySpec, type PromptOptions } from "@openuidev/lang-core";
import { readFileSync } from "fs";
import { join } from "path";
import { query } from "./db";

const DOMAIN_RULES = [
  "You are an analyst for an India-focused open data dashboard. All numbers come from the World Bank World Development Indicators, stored in our Postgres database.",
  "Never invent numbers. Every value you show must come from a tool result: get_indicator_series for trends, get_latest_snapshot for latest values. The catalog of codes is listed below, so you rarely need list_catalog.",
  "Only call the tools named list_catalog, get_indicator_series, get_latest_snapshot and create_dashboard. Fetch everything you need in one or two steps (you can call several tools in the same step), then write the UI.",
  "After fetching data you MUST answer with OpenUI Lang. Never end your turn with only tool calls.",
  'Live dashboards: when the user asks for a "live dashboard", a dashboard "with filters", or one to "save", "keep" or "reopen", call create_dashboard instead of the data tools. Describe in `prompt` the sections, KPIs, charts, tables and filters to build, without any numbers. Then reply with a short Card: one sentence on what the dashboard shows, and Buttons([Button("Open dashboard", @OpenUrl(url), "primary")]) using the exact `url` from the tool result. Do not repeat its data: you cannot see it.',
  "Default to India (IND). When the user asks for a comparison without naming countries, compare with China (CHN), Bangladesh (BGD) and the World (WLD).",
  "Layout: a short heading, a row of 2-4 KPI cards with the latest values and their year, then one chart per indicator, then a short takeaway. Do not put charts inside Tabs. Always state the data year and the source 'World Bank WDI'.",
  'Charts: copy `labels` from the tool result exactly. Labels are strings such as "2000", never bare numbers. Use one Series per country with its `values` array as returned, keeping null for missing years.',
  "Takeaways: only state numbers and comparisons you can read directly from the tool results (for example a value in a given year, or change between two years). Do not add causes or history that the data doesn't show.",
  "Format large values readably: US$ amounts in billions or trillions, populations in millions or crore, percentages with one decimal.",
];

let catalogCache: { text: string; at: number } | null = null;

/** A compact catalog of countries and indicators, so the model can skip a list_catalog round trip. */
export async function catalogText(): Promise<string> {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60_000) return catalogCache.text;
  const [countries, indicators] = await Promise.all([
    query<{ code: string; name: string }>("SELECT code, name FROM countries ORDER BY code = 'IND' DESC, name"),
    query<{ code: string; name: string; topic: string; unit: string | null; first_year: number; last_year: number }>(
      `SELECT i.code, i.name, i.topic, i.unit, min(o.year) AS first_year, max(o.year) AS last_year
         FROM indicators i JOIN observations o ON o.indicator_code = i.code
        GROUP BY i.code ORDER BY i.topic, i.name`,
    ),
  ]);
  const text = [
    "## Data catalog",
    "Countries: " + countries.map((c) => `${c.code} (${c.name})`).join(", "),
    "Indicators (code | name | unit | years):",
    ...indicators.map((i) => `- ${i.code} | ${i.name} | ${i.unit ?? ""} | ${i.first_year}-${i.last_year} [${i.topic}]`),
  ].join("\n");
  catalogCache = { text, at: Date.now() };
  return text;
}

/** Build the full OpenUI system prompt locally from the generated component spec. */
export async function systemPrompt(): Promise<string> {
  const { promptOptions, ...library } = JSON.parse(
    readFileSync(join(process.cwd(), "src/generated/spec.json"), "utf-8"),
  ) as LibrarySpec & { promptOptions?: PromptOptions };

  const prompt = generateSystemPrompt({
    library,
    promptOptions: {
      ...promptOptions,
      additionalRules: [...(promptOptions?.additionalRules ?? []), ...DOMAIN_RULES],
    },
  });
  return `${prompt}\n\n${await catalogText()}`;
}
