"use client";

import { Renderer } from "@openuidev/react-lang";
import { ThemeProvider, useSystemThemeMode } from "@openuidev/react-ui";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

type QueryLog = { id: number; tool: string; args: string; ms: number; ok: boolean; at: string };

type Props = {
  title: string;
  prompt: string;
  source: string;
  createdAt: string;
  /** Names of the server's data tools. */
  toolNames: string[];
};

/**
 * Renders a saved dashboard with the open-source OpenUI renderer.
 *
 * The dashboard's `Query()` calls run through `toolProvider`, which posts to
 * this app's own /api/tools route. Opening the page or changing a filter
 * re-queries Postgres. No LLM is called.
 */
export function LiveDashboard({ title, prompt, source, createdAt, toolNames }: Props) {
  const mode = useSystemThemeMode();
  const [log, setLog] = useState<QueryLog[]>([]);
  const [showSource, setShowSource] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const call = useCallback(async (tool: string, args: Record<string, unknown>) => {
    const started = performance.now();
    let ok = false;
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tool, args }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`);
      ok = true;
      return body.result;
    } finally {
      const entry = {
        tool,
        args: JSON.stringify(args),
        ms: Math.round(performance.now() - started),
        ok,
        at: new Date().toLocaleTimeString(),
      };
      setLog((prev) => [{ id: (prev[0]?.id ?? 0) + 1, ...entry }, ...prev].slice(0, 50));
    }
  }, []);

  // One function per tool name. Stable, so the renderer doesn't refetch on re-render.
  const toolProvider = useMemo(
    () =>
      Object.fromEntries(
        toolNames.map((name) => [name, (args: Record<string, unknown>) => call(name, args)]),
      ),
    [toolNames, call],
  );

  const onAction = useCallback((event: { type: string; params?: Record<string, unknown> }) => {
    const url = event.type === "open_url" ? event.params?.url : null;
    if (typeof url === "string" && /^(https?:\/\/|\/)/.test(url)) window.open(url, "_blank", "noopener");
  }, []);

  return (
    <ThemeProvider mode={mode}>
      <div className="live-dash">
        <header className="live-dash__bar">
          <div className="live-dash__titles">
            <nav className="live-dash__crumbs">
              <Link href="/">Chat</Link>
              <span>/</span>
              <Link href="/dashboards">Dashboards</Link>
            </nav>
            <h1>{title}</h1>
          </div>
          <div className="live-dash__stats">
            <span className="live-dash__pill live-dash__pill--live" title="Data comes straight from Postgres">
              <i /> Live from Postgres
            </span>
            <button
              type="button"
              className="live-dash__pill"
              onClick={() => setShowLog((v) => !v)}
              aria-expanded={showLog}
            >
              {log.length} {log.length === 1 ? "query" : "queries"} · 0 LLM calls
            </button>
            <button
              type="button"
              className="live-dash__pill"
              onClick={() => setShowSource((v) => !v)}
              aria-expanded={showSource}
            >
              {showSource ? "Hide source" : "View source"}
            </button>
          </div>
        </header>

        {showLog && (
          <section className="live-dash__panel" aria-label="Query log">
            <p className="live-dash__hint">
              Every data request this page has made. Change a filter and watch new rows appear: the
              browser calls <code>/api/tools</code>, which runs read-only SQL. The model is not involved.
            </p>
            {log.length === 0 ? (
              <p className="live-dash__hint">No queries yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Tool</th>
                    <th>Arguments</th>
                    <th>Took</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((q) => (
                    <tr key={q.id}>
                      <td>{q.at}</td>
                      <td>{q.tool}</td>
                      <td>
                        <code>{q.args}</code>
                      </td>
                      <td>{q.ok ? `${q.ms} ms` : "failed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {showSource && (
          <section className="live-dash__panel" aria-label="Dashboard source">
            <p className="live-dash__hint">
              The model wrote this OpenUI Lang once, on {new Date(createdAt).toLocaleDateString()}, for
              the request: <em>{prompt}</em>
            </p>
            <pre>{source}</pre>
          </section>
        )}

        <main className="live-dash__body">
          <Renderer
            response={source}
            library={openuiLibrary}
            isStreaming={false}
            toolProvider={toolProvider}
            onAction={onAction}
          />
        </main>
      </div>
    </ThemeProvider>
  );
}
