"use client";

import { useEffect, useState } from "react";
import { Stamp } from "@/components/site-kit";
import {
  PROOF_PROBES,
  tallyLine,
  type ProbeOutcome,
  type ProbeResult,
  type ProofReport,
  type ProofTally,
} from "@/lib/proof";

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
  const [tally, setTally] = useState<ProofTally | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/proof")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { tally?: ProofTally | null } | null) => {
        if (live && data?.tally) setTally(data.tally);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/proof", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "the proof did not run");
      setReport(data as ProofReport);
      if (data.tally) setTally(data.tally as ProofTally);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const accepted = report?.probes.filter((p) => p.outcome === "accepted").length ?? 0;
  const refused = report?.probes.filter((p) => p.outcome === "refused").length ?? 0;
  const ran = report !== null && report.probes.length > 0;

  return (
    <section
      aria-labelledby="proof-runner"
      className="overflow-hidden rounded-md border border-line-bright bg-surface shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]"
    >
      <div className="grid gap-6 border-b border-line-bright p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="max-w-xl">
          <h2
            id="proof-runner"
            className="font-display text-[1.9rem] font-medium leading-tight tracking-[-0.02em] text-fg"
          >
            Try to break it
          </h2>
          <p className="mt-3 leading-relaxed text-fg-dim">
            The button connects as <span className="tabular text-[0.88em] text-fg">stub_app</span>,
            the same least-privilege role the app runs as, and sends the six statements below. Each
            runs inside its own <span className="tabular text-[0.88em] text-fg">BEGIN</span> and{" "}
            <span className="tabular text-[0.88em] text-fg">ROLLBACK</span>, so nothing persists.
            The codes come straight from the database.
          </p>
          {tally && (
            <p className="mt-4 flex items-baseline gap-2.5 text-sm text-fg" aria-live="polite">
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${tally.accepted === 0 ? "bg-commit" : "bg-deny"}`}
              />
              {tallyLine(tally)}
            </p>
          )}
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="w-full shrink-0 rounded-md bg-brand px-6 py-3.5 text-[15px] font-semibold text-ink transition-colors hover:bg-brand-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60 md:w-auto"
        >
          {busy ? "Sending six statements…" : report ? "Send them again" : "Try to break it"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="border-b border-deny-dim bg-deny-dim/10 px-5 py-3 text-sm text-deny sm:px-7"
        >
          {error}
        </div>
      )}

      {report && (
        <div aria-live="polite">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line px-5 py-4 text-sm sm:grid-cols-4 sm:px-7">
            <Fact label="Connected as" value={report.role} />
            <Fact label="Region" value={report.region} />
            <Fact label="Total" value={`${report.totalMs} ms`} />
            <Fact
              label="Result"
              value={report.ran ? `${refused} of ${report.probes.length} refused` : "not run"}
            />
          </dl>

          {!report.ran && (
            <div className="border-b border-line bg-warn/10 px-5 py-3 text-sm text-warn sm:px-7">
              {report.reason}. The probe runs only on the app&apos;s own role, never as admin.
            </div>
          )}

          {accepted > 0 && (
            <div className="border-b border-deny bg-deny/15 px-5 py-3 text-sm font-semibold text-deny sm:px-7">
              The database accepted {accepted} of {report.probes.length} statements. Each was rolled
              back, but the claim on this page does not hold for them.
            </div>
          )}
        </div>
      )}

      <ol className="divide-y divide-line">
        {ran
          ? report.probes.map((probe, i) => <ProbeRow key={probe.id} probe={probe} index={i} />)
          : PROOF_PROBES.map((probe, i) => (
              <PendingRow
                key={probe.id}
                index={i}
                description={probe.description}
                sql={probe.sql}
                expected={probe.expected}
                busy={busy}
              />
            ))}
      </ol>

      {report && (
        <div className="border-t border-line px-5 py-3 text-xs text-fg-mute sm:px-7">
          Ran at {report.at}.
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-mute">{label}</dt>
      <dd className="tabular mt-0.5 break-words text-fg">{value}</dd>
    </div>
  );
}

function RowShell({
  index,
  description,
  sql,
  aside,
  children,
}: {
  index: number;
  description: string;
  sql: string;
  aside: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-5 py-5 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:px-7">
      <span className="tabular pt-0.5 text-xs text-fg-mute">{index + 1}</span>
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-fg">{description}</div>
        <code className="tabular mt-1.5 block break-words text-xs leading-relaxed text-fg-mute">
          {sql}
        </code>
        {children}
      </div>
      <div className="col-start-2 sm:col-start-3 sm:row-start-1 sm:self-center">{aside}</div>
    </li>
  );
}

function PendingRow({
  index,
  description,
  sql,
  expected,
  busy,
}: {
  index: number;
  description: string;
  sql: string;
  expected: string;
  busy: boolean;
}) {
  return (
    <RowShell
      index={index}
      description={description}
      sql={sql}
      aside={
        <span className={`tabular text-xs ${busy ? "text-brand" : "text-fg-mute"}`}>
          {busy ? "sending" : `expects ${expected}`}
        </span>
      }
    />
  );
}

function ProbeRow({ probe, index }: { probe: ProbeResult; index: number }) {
  const aside =
    probe.outcome === "refused" && probe.sqlstate ? (
      <Stamp code={probe.sqlstate} delay={index * 0.12} className="text-sm" />
    ) : (
      <span
        className={`tabular inline-block w-fit rounded-md border px-2.5 py-1 text-xs font-semibold ${OUTCOME_TONE[probe.outcome]}`}
      >
        {OUTCOME_LABEL[probe.outcome]}
        {probe.sqlstate && probe.outcome !== "error" ? ` ${probe.sqlstate}` : ""}
      </span>
    );

  return (
    <RowShell index={index} description={probe.description} sql={probe.sql} aside={aside}>
      <div className="mt-2.5 text-sm text-fg-dim">
        <span className="tabular text-fg">{probe.sqlstate ?? "no SQLSTATE"}</span>{" "}
        <span className="break-words">{probe.message}</span>
      </div>
      <div className="mt-1 text-xs text-fg-mute">
        Expected <span className="tabular">{probe.expected}</span>, answered in {probe.ms} ms,
        rolled back
      </div>
    </RowShell>
  );
}
