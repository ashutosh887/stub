"use client";

import { useState } from "react";
import { BUTTON, Notice } from "@/components/console-kit";
import { Stamp } from "@/components/site-kit";

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
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <h3 className="font-display text-xl font-medium text-fg">Retry without paying twice</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-dim">
            A naive retry around a payment that can&apos;t be undone sends the money again on every
            write conflict. Stub reserves first, pays once behind an idempotency key, then settles,
            so a retry replays only the ledger. Both run side by side with {report?.writers ?? 16}{" "}
            concurrent writers and crashes injected after payment.
          </p>
        </div>
        <button onClick={run} disabled={busy} className={`${BUTTON.primary} shrink-0`}>
          {busy ? "Running both…" : "Run both"}
        </button>
      </div>

      {error && (
        <div className="mt-5">
          <Notice tone="deny">{error}</Notice>
        </div>
      )}

      {report && (
        <div className="rise mt-6 grid border-t border-line sm:grid-cols-2 sm:divide-x sm:divide-line">
          <Column title="Naive retry" a={report.naive} />
          <Column title="Stub" a={report.stub} />
        </div>
      )}
    </div>
  );
}

function Column({ title, a }: { title: string; a: Approach }) {
  return (
    <div className="border-b border-line py-5 sm:border-b-0 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="font-display text-lg text-fg">{title}</span>
        {a.invariantsHold ? (
          <span className="text-[13px] text-commit">Paid once, balance held</span>
        ) : (
          <Stamp code="Paid twice" label="" delay={0.15} className="text-xs" />
        )}
      </div>
      <dl className="mt-3 text-sm">
        <Row k="Spends committed" v={String(a.committedSpends)} />
        <Row k="Payments sent" v={String(a.paymentsSent)} deny={a.doublePaid} />
        <Row k="Money charged" v={`$${a.chargedUsd.toFixed(2)}`} />
        <Row k="Write conflicts" v={String(a.occConflicts)} />
        <Row k="Final balance" v={`$${a.finalBalanceUsd.toFixed(2)}`} deny={a.overspend} />
        <Row k="Stuck holds" v={String(a.stuckHolds)} />
      </dl>
    </div>
  );
}

function Row({ k, v, deny = false }: { k: string; v: string; deny?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
      <dt className="text-fg-dim">{k}</dt>
      <dd className={`tabular ${deny ? "text-deny" : "text-fg"}`}>{v}</dd>
    </div>
  );
}
