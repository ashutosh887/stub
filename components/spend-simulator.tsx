"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = submitting || pending;

  async function authorize() {
    setSubmitting(true);
    setError(null);
    setOutcome(null);
    try {
      const res = await fetch("/api/spend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          budgetAccountId,
          vendorAccountId,
          amountUsd,
          intent,
          agentId: "research-agent",
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

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget account">
          <select
            value={budgetAccountId}
            onChange={(e) => setBudgetAccountId(e.target.value)}
            className="w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendor account">
          <select
            value={vendorAccountId}
            onChange={(e) => setVendorAccountId(e.target.value)}
            className="w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (USD)">
          <input
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
            inputMode="decimal"
            className="tabular w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
          />
        </Field>
        <Field label="Intent">
          <input
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            className="w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
          />
        </Field>
      </div>

      <button
        onClick={authorize}
        disabled={busy || !budgetAccountId || !vendorAccountId}
        className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Authorizing…" : "Authorize spend"}
      </button>

      {outcome && (
        <div
          className={`rise rounded-md border px-3 py-2.5 text-sm ${
            outcome.status === "committed"
              ? "border-commit-dim bg-commit-dim/20 text-commit"
              : outcome.status === "denied"
                ? "border-deny-dim bg-deny-dim/20 text-deny"
                : "border-line bg-surface-2 text-fg-dim"
          }`}
        >
          <span className="font-medium uppercase tracking-wide">{outcome.status}</span>
          {outcome.reason ? ` · ${outcome.reason}` : ""}
          {outcome.conflicts > 0
            ? ` · resolved ${outcome.conflicts} OCC conflict${outcome.conflicts > 1 ? "s" : ""}`
            : ""}
        </div>
      )}
      {error && (
        <div className="rise rounded-md border border-deny-dim bg-deny-dim/20 px-3 py-2.5 text-sm text-deny">
          {error}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-fg-mute">{label}</span>
      {children}
    </label>
  );
}
