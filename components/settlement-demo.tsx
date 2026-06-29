"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface AccountOption {
  id: string;
  name: string;
  type: string;
}

interface Held {
  reservationId: string;
  heldUsd: string;
}

export function SettlementDemo({
  budgets,
  vendors,
}: {
  budgets: AccountOption[];
  vendors: AccountOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [budgetAccountId, setBudgetAccountId] = useState(budgets[0]?.id ?? "");
  const [vendorAccountId, setVendorAccountId] = useState(vendors[0]?.id ?? "");
  const [estimateUsd, setEstimateUsd] = useState("4.00");
  const [actualUsd, setActualUsd] = useState("2.50");
  const [intent, setIntent] = useState("LLM call (estimated)");
  const [held, setHeld] = useState<Held | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "commit" | "deny" | "warn"; text: string } | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function call(url: string, body: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok && !data.status) throw new Error(data.error ?? "request failed");
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function doReserve() {
    setNote(null);
    try {
      const data = await call("/api/reserve", {
        budgetAccountId,
        vendorAccountId,
        amountUsd: estimateUsd,
        intent,
      });
      if (data.status === "reserved") {
        setHeld({ reservationId: data.reservationId, heldUsd: estimateUsd });
        setNote({ tone: "warn", text: `Held $${estimateUsd} — funds are reserved, nothing booked yet.` });
      } else {
        setNote({ tone: "deny", text: `Reservation ${data.status}${data.reason ? ` · ${data.reason}` : ""}.` });
      }
      refresh();
    } catch (err) {
      setNote({ tone: "deny", text: (err as Error).message });
    }
  }

  async function doSettle() {
    if (!held) return;
    try {
      const data = await call("/api/settle", { reservationId: held.reservationId, actualUsd });
      if (data.status === "settled") {
        const refund = (Number(held.heldUsd) - Number(actualUsd)).toFixed(2);
        setNote({
          tone: "commit",
          text: `Booked $${actualUsd} · refunded $${refund} of the hold. Vendor paid exactly once.`,
        });
        setHeld(null);
      } else {
        setNote({ tone: "deny", text: `Settle ${data.status}${data.reason ? ` · ${data.reason}` : ""}.` });
      }
      refresh();
    } catch (err) {
      setNote({ tone: "deny", text: (err as Error).message });
    }
  }

  async function doRelease() {
    if (!held) return;
    try {
      const data = await call("/api/release", { reservationId: held.reservationId });
      if (data.status === "released") {
        setNote({ tone: "commit", text: `Released $${held.heldUsd} back to the budget. Nothing booked.` });
        setHeld(null);
      } else {
        setNote({ tone: "deny", text: `Release ${data.status}${data.reason ? ` · ${data.reason}` : ""}.` });
      }
      refresh();
    } catch (err) {
      setNote({ tone: "deny", text: (err as Error).message });
    }
  }

  async function settleTwice() {
    if (!held) return;
    const id = held.reservationId;
    try {
      const [a, b] = await Promise.all([
        call("/api/settle", { reservationId: id, actualUsd }),
        call("/api/settle", { reservationId: id, actualUsd }),
      ]);
      const settled = [a, b].filter((r) => r.status === "settled").length;
      const dupes = [a, b].filter((r) => r.status === "duplicate").length;
      setNote({
        tone: settled === 1 ? "commit" : "deny",
        text: `Fired two settles at once → ${settled} booked, ${dupes} returned as duplicate. The vendor was charged once.`,
      });
      setHeld(null);
      refresh();
    } catch (err) {
      setNote({ tone: "deny", text: (err as Error).message });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget account">
          <Select value={budgetAccountId} onChange={setBudgetAccountId} options={budgets} disabled={!!held} />
        </Field>
        <Field label="Vendor account">
          <Select value={vendorAccountId} onChange={setVendorAccountId} options={vendors} disabled={!!held} />
        </Field>
        <Field label="Estimate to hold (USD)">
          <input
            value={estimateUsd}
            onChange={(e) => setEstimateUsd(e.target.value)}
            inputMode="decimal"
            disabled={!!held}
            className="tabular w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none disabled:opacity-50"
          />
        </Field>
        <Field label="Intent">
          <input
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={!!held}
            className="w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none disabled:opacity-50"
          />
        </Field>
      </div>

      {!held ? (
        <button
          onClick={doReserve}
          disabled={busy || !budgetAccountId || !vendorAccountId}
          className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"
        >
          {busy ? "Reserving…" : "① Reserve funds (hold the estimate)"}
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-warn/40 bg-warn/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-warn">
              Held · ${held.heldUsd}
            </span>
            <span className="tabular text-[11px] text-fg-mute">{held.reservationId.slice(0, 8)}…</span>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Actual cost (USD)">
              <input
                value={actualUsd}
                onChange={(e) => setActualUsd(e.target.value)}
                inputMode="decimal"
                className="tabular w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              />
            </Field>
            <button
              onClick={doSettle}
              disabled={busy}
              className="rounded-md bg-commit/90 px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              ② Settle
            </button>
            <button
              onClick={doRelease}
              disabled={busy}
              className="rounded-md border border-line-bright px-4 py-2 text-sm font-medium text-fg-dim transition-colors hover:text-fg disabled:opacity-40"
            >
              Release
            </button>
          </div>
          <button
            onClick={settleTwice}
            disabled={busy}
            className="self-start rounded-md border border-brand-dim px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-40"
          >
            Prove exactly-once → settle twice at the same instant
          </button>
        </div>
      )}

      {note && (
        <div
          className={`rise rounded-md border px-3 py-2.5 text-sm ${
            note.tone === "commit"
              ? "border-commit-dim bg-commit-dim/20 text-commit"
              : note.tone === "warn"
                ? "border-warn/40 bg-warn/10 text-warn"
                : "border-deny-dim bg-deny-dim/20 text-deny"
          }`}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: AccountOption[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-fg-mute">{label}</span>
      {children}
    </label>
  );
}
