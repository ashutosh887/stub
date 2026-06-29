"use client";

import { useState } from "react";

interface Result {
  count: number;
  committed: number;
  denied: number;
  conflicts: number;
  committedUsd: number;
  finalBalanceUsd: number;
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
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="max-w-xl">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">
            Overspend stress test
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            Fire 12 agents at one <span className="text-fg">$1.00</span> budget at the same instant,
            each trying to spend $0.25. Only four can fit. Watch the database hold the line — the
            rest collide on Aurora DSQL&apos;s concurrency control and lose with{" "}
            <span className="tabular text-fg">40001</span>.
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
        >
          {busy ? "Racing 12 agents…" : "Run stress test"}
        </button>
      </div>

      {error && (
        <div className="border-t border-deny-dim bg-deny-dim/10 px-6 py-3 text-sm text-deny">
          {error}
        </div>
      )}

      {result && (
        <div className="rise grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4 sm:divide-y-0">
          <Cell label="Committed" value={`${result.committed} · $${result.committedUsd.toFixed(2)}`} tone="commit" />
          <Cell label="Rejected" value={String(result.denied)} tone="deny" />
          <Cell label="OCC conflicts (40001)" value={String(result.conflicts)} tone="brand" />
          <Cell
            label="Final balance"
            value={`$${result.finalBalanceUsd.toFixed(2)}`}
            tone={result.neverNegative ? "default" : "deny"}
            sub={result.neverNegative ? "never went negative" : "NEGATIVE — bug"}
          />
        </div>
      )}
    </section>
  );
}

function Cell({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string;
  tone?: "default" | "commit" | "deny" | "brand";
  sub?: string;
}) {
  const color =
    tone === "commit"
      ? "text-commit"
      : tone === "deny"
        ? "text-deny"
        : tone === "brand"
          ? "text-brand"
          : "text-fg";
  return (
    <div className="px-6 py-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">{label}</div>
      <div className={`tabular mt-1 text-xl ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-fg-mute">{sub}</div>}
    </div>
  );
}
