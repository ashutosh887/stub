"use client";

import { useState } from "react";

interface ChainProblem {
  accountId: string;
  entryId: string;
  kind: string;
}

interface Report {
  ok: boolean;
  entryCount: number;
  accountCount: number;
  problems: ChainProblem[];
}

interface Tamper {
  detected: boolean;
  entryId: string | null;
  accountName: string | null;
  originalUsd: string;
  alteredUsd: string;
  problems: ChainProblem[];
}

export function AuditPanel({ initial }: { initial: Report }) {
  const [report, setReport] = useState<Report>(initial);
  const [tamper, setTamper] = useState<Tamper | null>(null);
  const [busy, setBusy] = useState<"verify" | "tamper" | null>(null);

  async function reverify() {
    setBusy("verify");
    try {
      const res = await fetch("/api/audit/verify");
      setReport(await res.json());
      setTamper(null);
    } finally {
      setBusy(null);
    }
  }

  async function runTamper() {
    setBusy("tamper");
    try {
      const res = await fetch("/api/audit/tamper-demo", { method: "POST" });
      setTamper(await res.json());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        className={`overflow-hidden rounded-2xl border ${
          report.ok ? "border-commit-dim" : "border-deny-dim"
        } bg-surface`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-4">
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
                report.ok ? "bg-commit-dim/30 text-commit" : "bg-deny-dim/30 text-deny"
              }`}
            >
              {report.ok ? "✓" : "✕"}
            </span>
            <div>
              <div className="text-lg font-semibold text-fg">
                {report.ok ? "Chain intact" : "Tampering detected"}
              </div>
              <div className="text-sm text-fg-dim">
                {report.ok
                  ? "Every entry's hash links cleanly back to genesis."
                  : `${report.problems.length} problem(s) found in the hash chain.`}
              </div>
            </div>
          </div>
          <button
            onClick={reverify}
            disabled={busy !== null}
            className="rounded-md border border-line px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-fg-mute transition-colors hover:border-line-bright hover:text-fg disabled:opacity-50"
          >
            {busy === "verify" ? "Verifying…" : "Re-verify"}
          </button>
        </div>
        <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
          <Stat label="Entries verified" value={String(report.entryCount)} />
          <Stat label="Account chains" value={String(report.accountCount)} />
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">
          Prove it catches tampering
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">
          Take a real committed entry, alter its amount by $1.00 in a throwaway copy, and re-run the
          verifier. The live ledger is never touched — this only demonstrates that any edited row
          breaks the chain.
        </p>
        <button
          onClick={runTamper}
          disabled={busy !== null}
          className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "tamper" ? "Altering a copy…" : "Demonstrate tamper detection"}
        </button>

        {tamper && (
          <div
            className={`rise mt-4 rounded-lg border p-4 ${
              tamper.detected ? "border-commit-dim bg-commit-dim/10" : "border-deny-dim bg-deny-dim/10"
            }`}
          >
            <div className="text-sm text-fg">
              {tamper.detected ? (
                <>
                  Altered <span className="text-fg-dim">{tamper.accountName}</span> entry from{" "}
                  <span className="tabular text-fg">${tamper.originalUsd}</span> to{" "}
                  <span className="tabular text-deny">${tamper.alteredUsd}</span> →{" "}
                  <span className="text-commit">detected.</span>
                </>
              ) : (
                "No entries available to test."
              )}
            </div>
            {tamper.detected && (
              <div className="mt-2 flex flex-wrap gap-2">
                {tamper.problems.map((p, i) => (
                  <span
                    key={i}
                    className="tabular rounded-md border border-deny-dim px-2 py-1 text-[11px] text-deny"
                  >
                    {p.kind} · {p.entryId.slice(0, 8)}…
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-6 py-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">{label}</div>
      <div className="tabular mt-1 text-lg text-fg">{value}</div>
    </div>
  );
}
