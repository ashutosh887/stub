"use client";

import { useState } from "react";
import type { Scenario } from "@/lib/incidents";

interface Result {
  scenario: Scenario;
  calls: number;
  committed: number;
  denied: number;
  conflicts: number;
  attemptedUsd: number;
  committedUsd: number;
  blockedUsd: number;
  finalBalanceUsd: number;
  capUsd: number;
  neverNegative: boolean;
}

export function IncidentReplay({ scenarios }: { scenarios: Scenario[] }) {
  const [selected, setSelected] = useState(scenarios[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenario = scenarios.find((s) => s.id === selected) ?? scenarios[0];

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/incident", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "incident replay failed");
      setResult(data as Result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSelected(s.id);
              setResult(null);
              setError(null);
            }}
            className={`rounded-xl border p-4 text-left transition-colors ${
              selected === s.id
                ? "border-brand-dim bg-brand/5"
                : "border-line bg-surface-2 hover:border-line-bright"
            }`}
          >
            <div className="text-sm font-semibold text-fg">{s.title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-dim">{s.story}</p>
            <div className="tabular mt-3 text-[11px] text-fg-mute">
              ${s.budgetUsd.toFixed(2)} cap · ${s.perCallUsd.toFixed(2)}/call · {s.calls} calls
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
        <p className="max-w-xl text-xs leading-relaxed text-fg-dim">
          <span className="text-brand">Context · </span>
          {scenario?.headline} Stub caps {scenario?.calls} runaway calls against a{" "}
          <span className="tabular text-fg">${scenario?.budgetUsd.toFixed(2)}</span> budget on the
          live Aurora DSQL cluster: only what fits commits, the rest collide on OCC and lose with{" "}
          <span className="tabular text-fg">40001</span>.
        </p>
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
        >
          {busy ? "Unleashing the agent…" : "Run the incident"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-deny-dim bg-deny-dim/10 px-4 py-3 text-sm text-deny">
          {error}
        </div>
      )}

      {result && (
        <div className="rise overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-fg-mute">
                Damage stopped
              </div>
              <div className="tabular mt-1 text-3xl font-semibold text-commit">
                ${result.blockedUsd.toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs text-fg-mute">
                runaway tried ${result.attemptedUsd.toFixed(2)} · Stub allowed only $
                {result.committedUsd.toFixed(2)}
              </div>
            </div>
            <div
              className={`rounded-lg border px-3 py-2 text-right ${
                result.neverNegative ? "border-commit-dim" : "border-deny-dim"
              }`}
            >
              <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">
                Final balance
              </div>
              <div className={`tabular text-lg ${result.neverNegative ? "text-fg" : "text-deny"}`}>
                ${result.finalBalanceUsd.toFixed(2)}
              </div>
              <div className="text-[11px] text-fg-mute">
                {result.neverNegative ? "never went negative" : "NEGATIVE: bug"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Runaway calls" value={String(result.calls)} />
            <Cell label="Committed" value={String(result.committed)} tone="commit" />
            <Cell label="Blocked" value={String(result.denied)} tone="deny" />
            <Cell label="OCC conflicts (40001)" value={String(result.conflicts)} tone="brand" />
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "commit" | "deny" | "brand";
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
    <div className="px-5 py-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">{label}</div>
      <div className={`tabular mt-1 text-xl ${color}`}>{value}</div>
    </div>
  );
}
