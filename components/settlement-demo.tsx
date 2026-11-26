"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BUTTON, Field, INPUT, Notice } from "@/components/console-kit";

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
        setNote({ tone: "warn", text: `Holding $${estimateUsd}. Nothing is booked yet.` });
      } else {
        setNote({
          tone: "deny",
          text: `Reservation ${data.status}${data.reason ? `, ${data.reason}` : ""}.`,
        });
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
          text: `Booked $${actualUsd} and refunded $${refund} of the hold. The vendor was paid once.`,
        });
        setHeld(null);
      } else {
        setNote({
          tone: "deny",
          text: `Settle ${data.status}${data.reason ? `, ${data.reason}` : ""}.`,
        });
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
        setNote({
          tone: "commit",
          text: `Released $${held.heldUsd} back to the budget. Nothing was booked.`,
        });
        setHeld(null);
      } else {
        setNote({
          tone: "deny",
          text: `Release ${data.status}${data.reason ? `, ${data.reason}` : ""}.`,
        });
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
        text: `Sent two settles at once. ${settled} booked, ${dupes} came back as a duplicate.${
          settled === 1 ? " The vendor was charged once." : ""
        }`,
      });
      setHeld(null);
      refresh();
    } catch (err) {
      setNote({ tone: "deny", text: (err as Error).message });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hold from">
          <Select
            value={budgetAccountId}
            onChange={setBudgetAccountId}
            options={budgets}
            disabled={!!held}
          />
        </Field>
        <Field label="Pay vendor">
          <Select
            value={vendorAccountId}
            onChange={setVendorAccountId}
            options={vendors}
            disabled={!!held}
          />
        </Field>
        <Field label="Estimate to hold, in USD">
          <input
            value={estimateUsd}
            onChange={(e) => setEstimateUsd(e.target.value)}
            inputMode="decimal"
            disabled={!!held}
            className={`tabular ${INPUT}`}
          />
        </Field>
        <Field label="Memo">
          <input
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={!!held}
            className={INPUT}
          />
        </Field>
      </div>

      {!held ? (
        <button
          onClick={doReserve}
          disabled={busy || !budgetAccountId || !vendorAccountId}
          className={BUTTON.primary}
        >
          {busy ? "Reserving…" : "Reserve the estimate"}
        </button>
      ) : (
        <div className="rise rounded-md border border-brand-dim bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-display text-lg text-fg">
              Holding <span className="tabular text-warn">${held.heldUsd}</span>
            </span>
            <span className="tabular text-xs text-fg-mute">{held.reservationId.slice(0, 8)}</span>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Real cost, in USD" className="sm:flex-1">
              <input
                value={actualUsd}
                onChange={(e) => setActualUsd(e.target.value)}
                inputMode="decimal"
                className={`tabular ${INPUT}`}
              />
            </Field>
            <div className="flex gap-2">
              <button onClick={doSettle} disabled={busy} className={`${BUTTON.primary} flex-1`}>
                Settle
              </button>
              <button onClick={doRelease} disabled={busy} className={`${BUTTON.secondary} flex-1`}>
                Release
              </button>
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <button onClick={settleTwice} disabled={busy} className={BUTTON.secondary}>
              Settle twice at once
            </button>
            <p className="mt-2 text-[13px] text-fg-mute">
              Two settles race for the same reservation. One books, the other comes back as a
              duplicate.
            </p>
          </div>
        </div>
      )}

      {note && <Notice tone={note.tone}>{note.text}</Notice>}
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
      className={INPUT}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
