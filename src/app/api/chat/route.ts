import { systemPrompt } from "@/lib/system-prompt";
import { chatModel } from "@/lib/llm";
import { chatTools } from "@/lib/tools";
import { overLimit } from "@/lib/usage-limit";
import { convertToModelMessages, stepCountIs, streamText } from "ai";

// pg needs the Node.js runtime, not Edge.
export const runtime = "nodejs";
// Generating a live dashboard takes about 30 seconds.
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return new Response("OPENROUTER_API_KEY is not set on the server.", {
      status: 500,
    });
  }

  const limited = await overLimit(req);
  if (limited) return new Response(limited, { status: 429 });

  const { messages } = await req.json();

  // Dev only: ?model=<openrouter id> to compare models without restarting.
  const override =
    process.env.NODE_ENV !== "production" ? new URL(req.url).searchParams.get("model") : null;

  const result = streamText({
    model: chatModel(override || undefined),
    system: await systemPrompt(),
    messages: await convertToModelMessages(messages),
    tools: chatTools(new URL(req.url).origin),
    stopWhen: stepCountIs(5),
    // A dashboard is ~2-4K tokens. Capping output also keeps OpenRouter's
    // per-request cost reservation small against the key's credit limit.
    maxOutputTokens: 8000,
    // Models sometimes keep calling tools, or stop without writing any UI.
    // After 3 steps, turn tools off so the next step has to be the answer.
    prepareStep: ({ stepNumber }) => (stepNumber >= 3 ? { toolChoice: "none" } : {}),
  });

  return result.toUIMessageStreamResponse({
    // Pass the real error (for example a rejected key) to the client instead of the SDK's generic text.
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
