import { dataTools } from "@/lib/data-tools";

export const runtime = "nodejs";

/**
 * The browser's data endpoint for live dashboards.
 *
 * OpenUI's renderer calls this through `toolProvider` whenever a dashboard
 * opens or a filter changes. Only the named, read-only tools can run: there is
 * no SQL in the request, and the database role cannot write.
 */
export async function POST(req: Request) {
  let body: { name?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { name, args }" }, { status: 400 });
  }

  const tool = typeof body.name === "string" ? dataTools[body.name] : undefined;
  if (!tool) {
    return Response.json(
      { error: `Unknown tool. Available: ${Object.keys(dataTools).join(", ")}` },
      { status: 404 },
    );
  }

  const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
  try {
    return Response.json({ result: await tool.execute(args) });
  } catch (error) {
    console.error(`[tools] ${body.name} failed`, error);
    return Response.json({ error: "The data query failed." }, { status: 500 });
  }
}
