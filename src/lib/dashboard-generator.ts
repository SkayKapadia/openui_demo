import "server-only";
import {
  createParser,
  generateSystemPrompt,
  type LibraryJSONSchema,
  type LibrarySpec,
  type PromptOptions,
} from "@openuidev/lang-core";
import { generateText } from "ai";
import { readFileSync } from "fs";
import { join } from "path";
import { saveDashboard, type Dashboard } from "./dashboard-store";
import { dataTools, toolSpecs } from "./data-tools";
import { chatModel, DEFAULT_MODEL } from "./llm";
import { catalogText } from "./system-prompt";

/**
 * Self-hosted dashboard generation.
 *
 * The model writes one OpenUI Lang program whose data comes from Query() calls
 * to our data tools. We check it with OpenUI's parser, give the model one
 * chance to fix any errors, and save the program to Postgres. From then on the
 * dashboard loads its own data: the model is not called again.
 */

const RULES = [
  "You build live dashboards about India and comparison countries from World Bank indicators. The dashboard is saved and reopened later, so it must load all of its data itself.",
  "Never write data values into the program. Every number, chart series and table row must come from a Query() result. Text such as titles and labels is fine.",
  "Only use the tools listed under available tools, with exactly those argument names. Indicator and country codes must come from the data catalog below.",
  "Give every Query a defaults object with the same fields you read from it, using empty arrays, empty strings and 0, so the dashboard renders before data arrives.",
  'Add filters when they help: declare a $variable with a default (for example $country = "IND"), bind it to a Select as its value, and write the $variable directly in the Query arguments so the query re-runs when it changes. Select values are strings.',
  "Do not pass endYear to get_series unless the user asks for a fixed end year: without it, each series ends at the latest year that has data.",
  "To compare countries on one line chart, call get_series once per country with the same startYear and endYear. Use the labels of the first query, and one Series per country with that query's values.",
  "Charts: LineChart(q.labels, [Series(q.countryName, q.values)]). Bar chart of a ranking: BarChart(r.rows.countryName, [Series(r.name, r.rows.value)]). Table: Table([Col(\"Indicator\", s.rows.name), Col(\"Value\", s.rows.value, \"number\")]).",
  'KPI cards: SnippetCardBlock of SnippetCardItem(id, IconText(Icon(name, category), "neutral", "m", title, subtitle, false, "horizontal"), BoldText("number", value, subtext, "text")). Build value strings by joining, for example "$" + @Round(q.latestValue, 0), and show the year from q.latestYear.',
  "Layout: root = Stack([...]) with the filters first, then KPI cards, then one Card per chart or table with a CardHeader. Do not use Tabs, forms, or buttons that message the assistant.",
  "Reply with the OpenUI Lang program only. No explanation before or after it.",
];

const EXAMPLE = readFileSync(join(process.cwd(), "db/seed/country-profile.openui"), "utf-8");

function loadSpec() {
  const { promptOptions, ...library } = JSON.parse(
    readFileSync(join(process.cwd(), "src/generated/spec.json"), "utf-8"),
  ) as LibrarySpec & { promptOptions?: PromptOptions; schema: LibraryJSONSchema; root: string };
  return { promptOptions, library };
}

async function systemPrompt(): Promise<string> {
  const { promptOptions, library } = loadSpec();
  const prompt = generateSystemPrompt({
    library,
    promptOptions: {
      tools: toolSpecs(),
      toolCalls: true,
      bindings: true,
      toolExamples: [EXAMPLE],
      additionalRules: [...(promptOptions?.additionalRules ?? []), ...RULES],
    },
  });
  return `${prompt}\n\n${await catalogText()}`;
}

/** Strip a surrounding code fence, if the model added one. */
function unfence(text: string): string {
  const match = text.match(/```[a-z-]*\n([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

/** Problems with a generated program, as plain sentences the model can act on. */
export function findProblems(program: string): string[] {
  const { library } = loadSpec();
  const result = createParser(library.schema, library.root).parse(program);
  const problems: string[] = [];

  if (result.root === null) problems.push("There is no usable `root` statement.");
  if (result.meta.incomplete) problems.push("The program is cut off or has unclosed brackets or strings.");
  for (const e of result.meta.errors) {
    problems.push(`${e.code} in ${e.component ?? "statement"}${e.path ? ` at ${e.path}` : ""}: ${e.message}`);
  }
  if (result.meta.unresolved.length) {
    problems.push(`These names are used but never defined: ${result.meta.unresolved.join(", ")}.`);
  }
  if (result.queryStatements.length === 0) {
    problems.push("The program has no Query() statements, so it would show no live data.");
  }
  for (const q of result.queryStatements) {
    // A string literal parses to { k: "Str", v: "<text>" }.
    const node = q.toolAST as { k?: string; v?: unknown } | null;
    const tool = node?.k === "Str" ? node.v : undefined;
    if (typeof tool !== "string" || !(tool in dataTools)) {
      problems.push(
        `Query "${q.statementId}" calls an unknown tool. Available: ${Object.keys(dataTools).join(", ")}.`,
      );
    }
  }
  return problems;
}

export type GenerateResult = { dashboard: Dashboard; attempts: number };

export async function generateDashboard(input: {
  title: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<GenerateResult> {
  const system = await systemPrompt();
  const request = `Build this dashboard.\nTitle: ${input.title}\nRequest: ${input.prompt}`;

  let program = "";
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text } = await generateText({
      model: chatModel(),
      system,
      maxOutputTokens: 8000,
      abortSignal: input.signal,
      messages:
        attempt === 1
          ? [{ role: "user", content: request }]
          : [
              { role: "user", content: request },
              { role: "assistant", content: program },
              {
                role: "user",
                content: `That program has problems:\n- ${problems.join("\n- ")}\n\nReply with the complete corrected program only.`,
              },
            ],
    });
    program = unfence(text);
    problems = findProblems(program);
    if (problems.length === 0) {
      const dashboard = await saveDashboard({
        title: input.title,
        prompt: input.prompt,
        source: program,
        model: DEFAULT_MODEL,
      });
      return { dashboard, attempts: attempt };
    }
  }
  throw new Error(`The dashboard could not be generated without errors: ${problems.slice(0, 3).join(" ")}`);
}
