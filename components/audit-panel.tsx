"use client";

import { useState } from "react";
import { BUTTON, Figure, LedgerSection } from "@/components/console-kit";
import { Stamp } from "@/components/site-kit";

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
    <>
      <LedgerSection
        id="verify"
        title="Chain check"
        note="Recomputes every hash from the first entry forward."
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {report.ok ? (
              <p className="font-display text-[2.4rem] font-medium leading-none tracking-[-0.02em] text-commit">
                Chain intact
              </p>
            ) : (
              <Stamp code="Chain broken" label="" delay={0} className="text-2xl" />
            )}
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-fg-dim">
              {report.ok
                ? "Every entry's hash links back to the start of its account's chain."
                : `The verifier found ${report.problems.length} ${
                    report.problems.length === 1 ? "break" : "breaks"
                  } in the hash chain.`}
            </p>
          </div>
          <button
            onClick={reverify}
            disabled={busy !== null}
            className={`${BUTTON.secondary} shrink-0`}
          >
            {busy === "verify" ? "Verifying…" : "Verify again"}
          </button>
        </div>
        <dl className="mt-7 grid max-w-md grid-cols-2 gap-6 border-t border-line pt-5">
          <Figure label="Entries verified" value={report.entryCount} />
          <Figure label="Account chains" value={report.accountCount} />
        </dl>
      </LedgerSection>

      <LedgerSection
        id="tamper"
        title="Catch an edit"
        note="Works on a throwaway copy. The live ledger is never touched."
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-xl text-[15px] leading-relaxed text-fg-dim">
            Take a committed entry, add $1.00 to its amount in a copy, and run the verifier on the
            copy. Any edited row breaks the chain at that line.
          </p>
          <button
            onClick={runTamper}
            disabled={busy !== null}
            className={`${BUTTON.primary} shrink-0`}
          >
            {busy === "tamper" ? "Editing a copy…" : "Edit a copy and verify"}
          </button>
        </div>

        {tamper && (
          <div className="rise mt-6 border-t border-line pt-5">
            {tamper.detected ? (
              <>
                <p className="text-[15px] text-fg-dim">
                  Changed a <span className="text-fg">{tamper.accountName}</span> entry from{" "}
                  <span className="tabular text-fg-mute line-through decoration-deny/70">
                    ${tamper.originalUsd}
                  </span>{" "}
                  to <span className="tabular text-fg">${tamper.alteredUsd}</span>. The verifier
                  caught it.
                </p>
                <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-4">
                  {tamper.problems.map((p, i) => (
                    <li key={i}>
                      <Stamp
                        code={p.entryId.slice(0, 8)}
                        label={p.kind.replace(/_/g, " ")}
                        delay={0.1 + i * 0.12}
                        className="text-xs"
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[15px] text-fg-mute">
                There are no entries to edit yet. Book a spend first.
              </p>
            )}
          </div>
        )}
      </LedgerSection>
    </>
  );
}
