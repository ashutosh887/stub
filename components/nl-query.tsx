"use client";

import { useState } from "react";

interface ResultRow {
  label: string;
  amountUsd: string;
  count: number;
}

interface AskResponse {
  answer: string;
  description: string;
  query: { metric: "total" | "count"; groupBy: string };
  rows: ResultRow[];
  error?: string;
}

const EXAMPLES = [
  "How much did Marketing's agents spend on data APIs?",
  "Top vendors by spend",
  "Which agent spent the most?",
  "How much spend got denied, and why?",
];

export function NlQuery() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = (await res.json()) as AskResponse;
      if (!res.ok) {
        setError(data.error ?? "query failed");
        return;
      }
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const maxAmount =
    result?.rows.reduce((m, r) => Math.max(m, Number(r.amountUsd)), 0) ?? 0;
  const maxCount = result?.rows.reduce((m, r) => Math.max(m, r.count), 0) ?? 0;
  const byCount = result?.query.metric === "count";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
          placeholder="Ask about your fleet's spend…"
          className="flex-1 rounded-md border bg-ink px-3 py-2.5 text-sm text-fg placeholder:text-fg-mute focus:border-brand focus:outline-none"
        />
        <button
          onClick={() => ask(question)}
          disabled={busy || !question.trim()}
          className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setQuestion(ex);
              ask(ex);
            }}
            disabled={busy}
            className="rounded-full border border-line bg-ink px-3 py-1 text-xs text-fg-dim transition-colors hover:border-line-bright hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"
          >
            {ex}
          </button>
        ))}
      </div>

      {result && (
        <div className="rise flex flex-col gap-4 rounded-lg border border-line bg-surface-2 p-4">
          <p className="text-sm leading-relaxed text-fg">{result.answer}</p>
          <div className="text-xs uppercase tracking-wide text-fg-mute">{result.description}</div>
          {result.rows.length > 0 && result.query.groupBy !== "none" && (
            <div className="flex flex-col gap-2">
              {result.rows.map((r) => {
                const value = byCount ? r.count : Number(r.amountUsd);
                const max = byCount ? maxCount : maxAmount;
                const pct = max > 0 ? (value / max) * 100 : 0;
                return (
                  <div key={r.label} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate text-sm text-fg-dim">{r.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="tabular w-24 shrink-0 text-right text-sm text-fg">
                      {byCount ? r.count : `$${r.amountUsd}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rise rounded-md border border-deny-dim bg-deny-dim/20 px-3 py-2.5 text-sm text-deny">
          {error}
        </div>
      )}
    </div>
  );
}
