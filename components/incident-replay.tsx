"use client";

import { useState } from "react";
import type { Scenario } from "@/lib/incidents";
import { BUTTON, Figure, LedgerSection, Notice } from "@/components/console-kit";
import { FOCUS, Stamp, TextLink } from "@/components/site-kit";

interface Result {
  scenario: Scenario;
  calls: number;
  committed: number;
  denied: number;
  conflicts: number;
  attemptedUsd: number;
  committedUsd: number;
  blockedUsd: number;
  failed: number;
  finalBalanceUsd: number;
  restoredBalanceUsd: number;
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
    <>
      <LedgerSection
        id="scenarios"
        title="Pick a pattern"
        note="Each one is modeled on a runaway pattern with a public write-up."
      >
        <ul className="divide-y divide-line border-y border-line" role="radiogroup">
          {scenarios.map((s) => {
            const active = selected === s.id;
            return (
              <li key={s.id}>
                <button
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSelected(s.id);
                    setResult(null);
                    setError(null);
                  }}
                  className={`grid w-full grid-cols-[1.25rem_minmax(0,1fr)] gap-3 border-l-2 py-4 pr-2 pl-3 text-left transition-colors sm:grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:gap-5 ${FOCUS} ${
                    active ? "border-brand bg-surface" : "border-transparent hover:bg-surface/60"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                      active ? "border-brand" : "border-fg-mute"
                    }`}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-lg text-fg">{s.title}</span>
                    <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-fg-dim">
                      {s.story}
                    </span>
                  </span>
                  <span className="tabular col-start-2 text-xs text-fg-mute sm:col-start-3 sm:text-right">
                    ${s.budgetUsd.toFixed(2)} cap
                    <br className="hidden sm:block" />
                    <span className="sm:hidden">, </span>${s.perCallUsd.toFixed(2)} a call
                    <br className="hidden sm:block" />
                    <span className="sm:hidden">, </span>
                    {s.calls} calls
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </LedgerSection>

      <LedgerSection
        id="replay"
        title="Run it"
        note="A drill budget on the live cluster, run as the app's own role. Your ledger is left alone."
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <p className="text-[15px] leading-relaxed text-fg-dim">{scenario?.headline}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-fg-dim">
              Stub fires {scenario?.calls} runaway calls at a{" "}
              <span className="tabular text-fg">${scenario?.budgetUsd.toFixed(2)}</span> drill
              budget. Each call places a hold. Only what fits is held; the rest collide on the
              balance row, retry on <span className="tabular text-fg">40001</span> and are refused.
              Then the holds are released, so the budget starts full on every run.
            </p>
            {scenario?.sourceUrl && (
              <p className="mt-3 text-sm text-fg-mute">
                Source: <TextLink href={scenario.sourceUrl}>{scenario.sourceLabel}</TextLink>
              </p>
            )}
          </div>
          <button onClick={run} disabled={busy} className={`${BUTTON.primary} shrink-0`}>
            {busy ? "Running…" : "Run the incident"}
          </button>
        </div>

        {error && (
          <div className="mt-6">
            <Notice tone="deny">{error}</Notice>
          </div>
        )}

        {result && (
          <div className="rise mt-8 border-t border-line pt-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-[13px] text-fg-mute">Kept in the budget</p>
                <p className="mt-1 w-fit border-b-[3px] border-double border-fg-mute pb-0.5 font-display text-[2.8rem] font-medium leading-none tracking-[-0.02em] text-commit [font-variant-numeric:lining-nums_tabular-nums]">
                  ${result.blockedUsd.toFixed(2)}
                </p>
                <p className="mt-3 text-sm text-fg-dim">
                  The runaway asked for{" "}
                  <span className="tabular text-fg">${result.attemptedUsd.toFixed(2)}</span>. Stub
                  held <span className="tabular text-fg">${result.committedUsd.toFixed(2)}</span>{" "}
                  and refused the rest.
                </p>
              </div>
              <Stamp
                code={`${result.denied + result.failed} refused`}
                label=""
                delay={0.2}
                className="text-base"
              />
            </div>
            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-5">
              <Figure label="Runaway calls" value={result.calls} />
              <Figure label="Held" tone="commit" value={result.committed} />
              <Figure label="Refused" tone="deny" value={result.denied + result.failed} />
              <Figure label="Write conflicts" tone="brand" value={result.conflicts} sub="40001" />
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
          </div>
        )}
      </LedgerSection>
    </>
  );
}
