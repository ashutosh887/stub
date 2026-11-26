"use client";

import { useState } from "react";
import type { ProbeOutcome, ProbeResult, ProofReport } from "@/lib/proof";

const OUTCOME_LABEL: Record<ProbeOutcome, string> = {
  refused: "Refused",
  "refused-differently": "Refused, other code",
  accepted: "ACCEPTED",
  "no-row": "Not tested",
  error: "No answer",
};

const OUTCOME_TONE: Record<ProbeOutcome, string> = {
  refused: "border-commit-dim bg-commit/10 text-commit",
  "refused-differently": "border-brand-dim bg-warn/10 text-warn",
  accepted: "border-deny bg-deny/15 text-deny",
  "no-row": "border-brand-dim bg-warn/10 text-warn",
  error: "border-brand-dim bg-warn/10 text-warn",
};

export function ProofRunner() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ProofReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/proof", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "the proof did not run");
      setReport(data as ProofReport);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const accepted = report?.probes.filter((p) => p.outcome === "accepted").length ?? 0;
  const refused = report?.probes.filter((p) => p.outcome === "refused").length ?? 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="max-w-xl">
          <h2 className="font-display text-2xl font-semibold text-fg">Try to break it</h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            The button connects as <span className="tabular text-fg">stub_app</span>, the same
            least-privilege database role the app runs as, and sends five statements that would
            overspend a budget or rewrite the ledger. Each runs inside its own{" "}
            <span className="tabular text-fg">BEGIN … ROLLBACK</span>, so nothing persists. The
            codes below come straight from the database.
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
        >
          {busy ? "Sending five statements…" : "Try to break it"}
        </button>
      </div>

      {error && (
        <div className="border-t border-deny-dim bg-deny-dim/10 px-6 py-3 text-sm text-deny">
          {error}
        </div>
      )}

      {report && (
        <div className="rise border-t border-line">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-6 py-4 text-sm sm:grid-cols-4">
            <Fact label="Connected as" value={report.role} />
            <Fact label="Region" value={report.region} />
            <Fact label="Total" value={`${report.totalMs} ms`} />
            <Fact
              label="Result"
              value={report.ran ? `${refused} of ${report.probes.length} refused` : "not run"}
            />
          </dl>

          {!report.ran && (
            <div className="border-t border-line bg-warn/10 px-6 py-3 text-sm text-warn">
              {report.reason}. The probe runs only on the app&apos;s own role, never as admin.
            </div>
          )}

          {accepted > 0 && (
            <div className="border-t border-deny bg-deny/15 px-6 py-3 text-sm font-semibold text-deny">
              The database accepted {accepted} of {report.probes.length} statements. Each was rolled
              back, but the claim on this page does not hold for them.
            </div>
          )}

          {report.probes.length > 0 && (
            <ol className="divide-y divide-line border-t border-line">
              {report.probes.map((probe) => (
                <ProbeRow key={probe.id} probe={probe} />
              ))}
            </ol>
          )}

          <div className="border-t border-line px-6 py-3 text-[11px] text-fg-mute">
            Ran at {report.at}.
          </div>
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">{label}</dt>
      <dd className="tabular mt-0.5 break-words text-fg">{value}</dd>
    </div>
  );
}

function ProbeRow({ probe }: { probe: ProbeResult }) {
  return (
    <li className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{probe.description}</div>
        <code className="tabular mt-1 block break-words text-xs text-fg-mute">{probe.sql}</code>
        <div className="mt-2 text-sm text-fg-dim">
          <span className="tabular text-fg">{probe.sqlstate ?? "no SQLSTATE"}</span>{" "}
          <span className="break-words">{probe.message}</span>
        </div>
        <div className="mt-1 text-[11px] text-fg-mute">
          Expected <span className="tabular">{probe.expected}</span> · {probe.ms} ms, rolled back
        </div>
      </div>
      <span
        className={`tabular w-fit shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold ${OUTCOME_TONE[probe.outcome]}`}
      >
        {OUTCOME_LABEL[probe.outcome]}
        {probe.sqlstate && probe.outcome !== "error" ? ` ${probe.sqlstate}` : ""}
      </span>
    </li>
  );
}
