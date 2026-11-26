"use client";

import { useState } from "react";
import { BUTTON, INPUT, Notice } from "@/components/console-kit";
import { FOCUS } from "@/components/site-kit";

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

  const maxAmount = result?.rows.reduce((m, r) => Math.max(m, Number(r.amountUsd)), 0) ?? 0;
  const maxCount = result?.rows.reduce((m, r) => Math.max(m, r.count), 0) ?? 0;
  const byCount = result?.query.metric === "count";

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did the fleet spend on LLM tokens?"
          aria-label="Question about the ledger"
          className={`${INPUT} py-2.5 sm:flex-1`}
        />
        <button type="submit" disabled={busy || !question.trim()} className={BUTTON.primary}>
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>

      <div className="text-sm text-fg-mute">
        <span>Or try one of these:</span>
        <ul className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5">
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button
                onClick={() => {
                  setQuestion(ex);
                  ask(ex);
                }}
                disabled={busy}
                className={`rounded-sm text-left text-fg-dim underline decoration-line-bright underline-offset-4 transition-colors hover:text-fg hover:decoration-brand disabled:opacity-40 ${FOCUS}`}
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {result && (
        <div className="rise mt-2 border-t border-line pt-5">
          <p className="max-w-2xl font-display text-xl leading-snug text-fg">{result.answer}</p>
          <p className="mt-2 text-[13px] text-fg-mute">{result.description}</p>
          {result.rows.length > 0 && result.query.groupBy !== "none" && (
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {result.rows.map((r) => {
                const value = byCount ? r.count : Number(r.amountUsd);
                const max = byCount ? maxCount : maxAmount;
                const pct = max > 0 ? (value / max) * 100 : 0;
                return (
                  <li
                    key={r.label}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)_7rem]"
                  >
                    <span className="truncate text-sm text-fg">{r.label}</span>
                    <div className="order-last col-span-2 h-1.5 bg-line sm:order-none sm:col-span-1">
                      <div className="h-full bg-brand" style={{ width: `${Math.max(pct, 1)}%` }} />
                    </div>
                    <span className="tabular text-right text-sm text-fg">
                      {byCount ? r.count : `$${r.amountUsd}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && <Notice tone="deny">{error}</Notice>}
    </div>
  );
}
