import "server-only";
import { createOpenAI } from "@ai-sdk/openai";

// OpenRouter speaks the OpenAI chat-completions API.
const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: { "X-Title": "India Open Data Dashboard" },
});

export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5";

export const chatModel = (id: string = DEFAULT_MODEL) => openrouter.chat(id);
