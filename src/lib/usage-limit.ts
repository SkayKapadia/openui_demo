import "server-only";
import { createHash } from "crypto";
import { storePool } from "./dashboard-store";

/**
 * A daily usage limit for the public demo, so strangers can't run up the LLM bill.
 *
 * Off by default. Set CHAT_DAILY_LIMIT_PER_CLIENT and/or CHAT_DAILY_LIMIT_TOTAL
 * to turn it on. Counts live in Postgres because serverless instances don't
 * share memory. The provider's own credit limit remains the hard backstop.
 */

const perClient = Number(process.env.CHAT_DAILY_LIMIT_PER_CLIENT) || 0;
const total = Number(process.env.CHAT_DAILY_LIMIT_TOTAL) || 0;

/** A salted hash of the caller's IP, so the address itself is never stored. */
function clientKey(req: Request, day: string): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`${day}:${ip}`).digest("hex").slice(0, 32);
}

/** Counts this request. Returns a message when the caller is over a limit, else null. */
export async function overLimit(req: Request): Promise<string | null> {
  if (!perClient && !total) return null;
  const day = new Date().toISOString().slice(0, 10);

  try {
    const { rows } = await storePool.query<{ mine: number; everyone: string }>(
      `WITH bump AS (
         INSERT INTO chat_usage (day, client, count) VALUES ($1, $2, 1)
         ON CONFLICT (day, client) DO UPDATE SET count = chat_usage.count + 1
         RETURNING count
       )
       SELECT (SELECT count FROM bump) AS mine,
              (SELECT coalesce(sum(count), 0) FROM chat_usage WHERE day = $1) AS everyone`,
      [day, clientKey(req, day)],
    );
    const { mine, everyone } = rows[0];
    if (perClient && mine > perClient) {
      return `This demo allows ${perClient} questions per visitor per day. Please come back tomorrow, or run it yourself from the GitHub repo.`;
    }
    // `everyone` is read before this request's own row is visible, so allow equality.
    if (total && Number(everyone) >= total) {
      return "This demo has reached its daily question limit. Saved dashboards still work: open the Dashboards page.";
    }
    return null;
  } catch (error) {
    // If the counter itself fails, fail closed: a broken limiter must not mean unlimited use.
    console.error("[usage-limit] check failed", error);
    return "The demo's usage counter is unavailable right now. Please try again later.";
  }
}
