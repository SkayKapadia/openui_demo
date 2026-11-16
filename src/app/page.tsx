"use client";

import { localStorageChat } from "@/lib/local-storage";
import {
  AgentInterface,
  fetchLLM,
  useSystemThemeMode,
  vercelAIAdapter,
  vercelAIMessageFormat,
} from "@openuidev/react-ui";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";

const { llm, storage } = localStorageChat(
  fetchLLM({
    url: "/api/chat",
    streamAdapter: vercelAIAdapter(),
    messageFormat: vercelAIMessageFormat,
  }),
  "india-open-data",
);

export default function Page() {
  const mode = useSystemThemeMode();

  // The route returns the AI SDK's native UIMessage stream, so the browser
  // decodes it with the SDK's own adapter and message format.
  return (
    <div className="app-shell">
      <AgentInterface
        llm={llm}
        storage={storage}
        componentLibrary={openuiLibrary}
        agentName="India Open Data"
        theme={{ mode }}
        starterVariant="short"
        starters={[
          {
            displayText: "India at a glance",
            prompt: "Give me a dashboard of India's latest key indicators: GDP, GDP per capita, population, life expectancy and internet use.",
          },
          {
            displayText: "India vs China since 2000",
            prompt: "Compare India and China's GDP per capita since 2000.",
          },
          {
            displayText: "Electricity & internet",
            prompt: "How have electricity access and internet use grown in India since 2000?",
          },
          {
            displayText: "South Asia health",
            prompt: "Compare life expectancy and under-5 mortality for India, Bangladesh and Pakistan since 1990.",
          },
        ]}
      />
    </div>
  );
}
