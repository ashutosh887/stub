"use client";

import { useState } from "react";

interface Approach {
  approach: string;
  committedSpends: number;
  paymentsAttempted: number;
  paymentsSent: number;
  chargedUsd: number;
  finalBalanceUsd: number;
  occConflicts: number;
  stuckHolds: number;
  overspend: boolean;
  doublePaid: boolean;
  invariantsHold: boolean;
}

interface Report {
  affordable: number;
  writers: number;
  naive: Approach;
  stub: Approach;
}

export function ExactlyOnce() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/harness", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "harness failed");
      setReport(data as Report);
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
            Exactly-once settlement
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            A naive retry around an irreversible payment double-charges: every OCC conflict re-sends
            the money. Stub reserves, pays once behind an idempotency key, then settles, so retries
            replay only the ledger. Run both side by side under {report?.writers ?? 16} concurrent
            writers with crashes injected after payment.
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
        >
          {busy ? "Running both…" : "Run the comparison"}
        </button>
      </div>

      {error && (
        <div className="border-t border-deny-dim bg-deny-dim/10 px-6 py-3 text-sm text-deny">
          {error}
        </div>
      )}

      {report && (
        <div className="rise grid gap-px border-t border-line bg-line sm:grid-cols-2">
          <Column title="Naive retry" a={report.naive} />
          <Column title="Stub" a={report.stub} />
        </div>
      )}
    </section>
  );
}

function Column({ title, a }: { title: string; a: Approach }) {
  return (
    <div className="bg-surface p-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-fg">{title}</span>
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] ${
            a.invariantsHold ? "border-commit-dim text-commit" : "border-deny-dim text-deny"
          }`}
        >
          {a.invariantsHold ? "invariants hold" : "double-pay"}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Row k="Spends committed" v={String(a.committedSpends)} />
        <Row
          k="Payments sent"
          v={String(a.paymentsSent)}
          tone={a.doublePaid ? "deny" : "default"}
        />
        <Row k="Money charged" v={`$${a.chargedUsd.toFixed(2)}`} />
        <Row k="OCC conflicts" v={String(a.occConflicts)} />
        <Row
          k="Final balance"
          v={`$${a.finalBalanceUsd.toFixed(2)}`}
          tone={a.overspend ? "deny" : "default"}
        />
        <Row k="Stuck holds" v={String(a.stuckHolds)} />
      </dl>
    </div>
  );
}

function Row({ k, v, tone = "default" }: { k: string; v: string; tone?: "default" | "deny" }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">{k}</dt>
      <dd className={`tabular mt-0.5 text-base ${tone === "deny" ? "text-deny" : "text-fg"}`}>
        {v}
      </dd>
    </div>
  );
}
