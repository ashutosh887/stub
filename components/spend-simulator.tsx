"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BUTTON, Field, INPUT, Notice, reasonLabel } from "@/components/console-kit";
import { Stamp } from "@/components/site-kit";

interface AccountOption {
  id: string;
  name: string;
  type: string;
}

interface Outcome {
  status: string;
  reason?: string;
  conflicts: number;
  attempts: number;
}

export function SpendSimulator({
  budgets,
  vendors,
}: {
  budgets: AccountOption[];
  vendors: AccountOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [budgetAccountId, setBudgetAccountId] = useState(budgets[0]?.id ?? "");
  const [vendorAccountId, setVendorAccountId] = useState(vendors[0]?.id ?? "");
  const [amountUsd, setAmountUsd] = useState("2.40");
  const [intent, setIntent] = useState("data API call");
  const [costCenter, setCostCenter] = useState("Marketing");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = submitting || pending;

  async function authorize(approve = false) {
    setSubmitting(true);
    setError(null);
    if (!approve) setOutcome(null);
    try {
      const res = await fetch("/api/spend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          budgetAccountId,
          vendorAccountId,
          amountUsd,
          intent,
          costCenter,
          agentId: "research-agent",
          approve,
        }),
      });
      const data = (await res.json()) as Outcome & { error?: string };
      if (data.error) {
        setError(data.error);
      } else {
        setOutcome(data);
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const conflictNote =
    outcome && outcome.conflicts > 0
      ? ` It lost ${outcome.conflicts} write conflict${outcome.conflicts > 1 ? "s" : ""} first and retried.`
      : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <Field label="Spend from">
          <select
            value={budgetAccountId}
            onChange={(e) => setBudgetAccountId(e.target.value)}
            className={INPUT}
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pay vendor">
          <select
            value={vendorAccountId}
            onChange={(e) => setVendorAccountId(e.target.value)}
            className={INPUT}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount in USD">
          <input
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
            inputMode="decimal"
            className={`tabular ${INPUT}`}
          />
        </Field>
        <Field label="Memo">
          <input value={intent} onChange={(e) => setIntent(e.target.value)} className={INPUT} />
        </Field>
        <Field label="Cost center">
          <input
            value={costCenter}
            onChange={(e) => setCostCenter(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>

      <button
        onClick={() => authorize()}
        disabled={busy || !budgetAccountId || !vendorAccountId}
        className={BUTTON.primary}
      >
        {busy ? "Authorizing…" : "Authorize spend"}
      </button>

      {outcome?.status === "committed" && (
        <Notice tone="commit">Committed. Two lines booked in the journal.{conflictNote}</Notice>
      )}
      {outcome?.status === "denied" && (
        <div className="rise flex flex-wrap items-center gap-x-4 gap-y-3 py-1">
          <Stamp code={reasonLabel(outcome.reason ?? "denied")} delay={0} className="text-sm" />
          <span className="text-sm text-fg-dim">Nothing was paid. The refusal is on record.</span>
        </div>
      )}
      {outcome?.status === "needs_approval" && (
        <Notice tone="warn">
          <p>This is over the approval threshold, so a person has to sign off.</p>
          <button
            onClick={() => authorize(true)}
            disabled={busy}
            className="mt-2 rounded-md border border-warn/60 px-3 py-1 text-[13px] font-medium text-warn transition-colors hover:bg-warn/10 disabled:opacity-50"
          >
            {busy ? "Approving…" : "Approve and authorize"}
          </button>
        </Notice>
      )}
      {outcome && !["committed", "denied", "needs_approval"].includes(outcome.status) && (
        <Notice tone="warn">
          {outcome.status === "duplicate"
            ? "Already booked under this idempotency key. Nothing new was charged."
            : outcome.status}
        </Notice>
      )}
      {error && <Notice tone="deny">{error}</Notice>}
    </div>
  );
}
