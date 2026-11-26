"use client";

import { useState } from "react";
import { BUTTON, Figure, Notice } from "@/components/console-kit";
import { Stamp } from "@/components/site-kit";

interface Result {
  count: number;
  committed: number;
  denied: number;
  conflicts: number;
  failed: number;
  committedUsd: number;
  finalBalanceUsd: number;
  restoredBalanceUsd: number;
  neverNegative: boolean;
}

export function StressTest() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/stress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 12 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "stress test failed");
      setResult(data as Result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <h3 className="font-display text-xl font-medium text-fg">Twelve agents, one dollar</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-dim">
            Twelve agents each try to hold <span className="tabular text-fg">$0.25</span> from one{" "}
            <span className="tabular text-fg">$1.00</span> drill budget at the same instant. Four
            fit. The rest collide in Aurora DSQL&apos;s concurrency control, retry on{" "}
            <span className="tabular text-fg">40001</span> and are refused. Then every hold is
            released, so the budget is back at $1.00 for the next run.
          </p>
        </div>
        <button onClick={run} disabled={busy} className={`${BUTTON.primary} shrink-0`}>
          {busy ? "Racing 12 agents…" : "Run the race"}
        </button>
      </div>

      {error && (
        <div className="mt-5">
          <Notice tone="deny">{error}</Notice>
        </div>
      )}

      {result && (
        <dl className="rise mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-4">
          <Figure
            label="Held"
            tone="commit"
            value={`${result.committed} for $${result.committedUsd.toFixed(2)}`}
          />
          <Figure
            label="Refused"
            tone="deny"
            value={result.denied + result.failed}
            sub={result.failed > 0 ? `${result.failed} hit an error and placed no hold` : undefined}
          />
          <div className="min-w-0">
            <dt className="text-[13px] text-fg-mute">Write conflicts</dt>
            <dd className="mt-1 flex items-center gap-3">
              <span className="tabular text-lg text-fg">{result.conflicts}</span>
              {result.conflicts > 0 && (
                <Stamp code="40001" label="" delay={0.1} className="text-xs" />
              )}
            </dd>
          </div>
          <Figure
            label="Lowest balance"
            tone={result.neverNegative ? "default" : "deny"}
            value={`$${result.finalBalanceUsd.toFixed(2)}`}
            sub={
              result.neverNegative
                ? `Never below zero. $${result.restoredBalanceUsd.toFixed(2)} after release.`
                : "Went below zero. This is a bug."
            }
          />
        </dl>
      )}
    </div>
  );
}
