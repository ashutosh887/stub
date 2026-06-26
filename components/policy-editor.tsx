"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface AccountOption {
  id: string;
  name: string;
  type: string;
}

export interface PolicyView {
  id: string;
  accountId: string;
  accountName: string;
  label: string;
  enabled: boolean;
  limitUsd: string | null;
  windowSeconds: number | null;
  vendorAllow: string[] | null;
  vendorBlock: string[] | null;
  approvalUsd: string | null;
}

const WINDOWS = [
  { label: "per transaction", seconds: 0 },
  { label: "per hour", seconds: 3600 },
  { label: "per day", seconds: 86400 },
];

function windowLabel(seconds: number | null): string {
  if (seconds == null) return "per transaction";
  return WINDOWS.find((w) => w.seconds === seconds)?.label ?? `per ${seconds}s`;
}

export function PolicyEditor({
  policies,
  budgets,
  vendors,
}: {
  policies: PolicyView[];
  budgets: AccountOption[];
  vendors: AccountOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [accountId, setAccountId] = useState(budgets[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [capUsd, setCapUsd] = useState("");
  const [windowSeconds, setWindowSeconds] = useState(0);
  const [approvalUsd, setApprovalUsd] = useState("");
  const [vendorMode, setVendorMode] = useState<"none" | "allow" | "block">("none");
  const [vendorIds, setVendorIds] = useState<string[]>([]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;

  function reset() {
    setLabel("");
    setCapUsd("");
    setWindowSeconds(0);
    setApprovalUsd("");
    setVendorMode("none");
    setVendorIds([]);
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { accountId, label: label.trim() || "Policy" };
      if (capUsd.trim()) {
        body.limitUsd = capUsd.trim();
        if (windowSeconds > 0) body.windowSeconds = windowSeconds;
      }
      if (approvalUsd.trim()) body.approvalThresholdUsd = approvalUsd.trim();
      if (vendorMode === "allow" && vendorIds.length) body.vendorAllow = vendorIds;
      if (vendorMode === "block" && vendorIds.length) body.vendorBlock = vendorIds;

      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "failed to create policy");
        return;
      }
      reset();
      setOpen(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch("/api/policies", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/policies?id=${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col divide-y divide-line">
        {policies.length === 0 && (
          <div className="py-6 text-center text-sm text-fg-mute">
            No policies yet. Spend is gated only by the account balance. Add a rule to enforce
            per-transaction caps, rolling-window ceilings, vendor lists, or approval thresholds.
          </div>
        )}
        {policies.map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm ${p.enabled ? "text-fg" : "text-fg-mute line-through"}`}>
                  {p.label || "Policy"}
                </span>
                <span className="text-xs text-fg-mute">· {p.accountName}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.limitUsd && (
                  <Chip>
                    ≤ ${p.limitUsd} {windowLabel(p.windowSeconds)}
                  </Chip>
                )}
                {p.approvalUsd && <Chip tone="warn">approval &gt; ${p.approvalUsd}</Chip>}
                {p.vendorAllow?.length ? (
                  <Chip>allow: {p.vendorAllow.map(vendorName).join(", ")}</Chip>
                ) : null}
                {p.vendorBlock?.length ? (
                  <Chip tone="deny">block: {p.vendorBlock.map(vendorName).join(", ")}</Chip>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => toggle(p.id, !p.enabled)}
                className="rounded px-2 py-0.5 text-xs text-fg-mute transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {p.enabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={() => remove(p.id)}
                className="rounded px-2 py-0.5 text-xs text-fg-mute transition-colors hover:bg-deny-dim/30 hover:text-deny focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="self-start rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg transition-colors hover:border-line-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          + Add policy
        </button>
      ) : (
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Applies to">
              <Select value={accountId} onChange={setAccountId}>
                {budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name">
              <Input value={label} onChange={setLabel} placeholder="Daily ceiling" />
            </Field>
            <Field label="Cap (USD)">
              <Input value={capUsd} onChange={setCapUsd} placeholder="e.g. 10.00" inputMode="decimal" />
            </Field>
            <Field label="Window">
              <Select value={String(windowSeconds)} onChange={(v) => setWindowSeconds(Number(v))}>
                {WINDOWS.map((w) => (
                  <option key={w.seconds} value={w.seconds}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Require approval over (USD)">
              <Input
                value={approvalUsd}
                onChange={setApprovalUsd}
                placeholder="e.g. 5.00"
                inputMode="decimal"
              />
            </Field>
            <Field label="Vendor rule">
              <Select value={vendorMode} onChange={(v) => setVendorMode(v as typeof vendorMode)}>
                <option value="none">no vendor restriction</option>
                <option value="allow">allow only selected</option>
                <option value="block">block selected</option>
              </Select>
            </Field>
          </div>

          {vendorMode !== "none" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {vendors.map((v) => {
                const on = vendorIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() =>
                      setVendorIds((ids) =>
                        on ? ids.filter((i) => i !== v.id) : [...ids, v.id],
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      on
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-line bg-ink text-fg-dim hover:border-line-bright"
                    }`}
                  >
                    {v.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={create}
              disabled={busy || !accountId}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save policy"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
                reset();
              }}
              className="text-sm text-fg-mute hover:text-fg focus-visible:outline-none"
            >
              Cancel
            </button>
          </div>
          {error && (
            <div className="rise mt-3 rounded-md border border-deny-dim bg-deny-dim/20 px-3 py-2 text-sm text-deny">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "warn" | "deny" }) {
  const cls =
    tone === "deny"
      ? "border-deny-dim text-deny"
      : tone === "warn"
        ? "border-warn/40 text-warn"
        : "border-line text-fg-dim";
  return (
    <span className={`tabular rounded border px-1.5 py-0.5 text-xs ${cls}`}>{children}</span>
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

function Input({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "decimal";
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      className="w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg placeholder:text-fg-mute focus:border-brand focus:outline-none"
    />
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border bg-ink px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none"
    >
      {children}
    </select>
  );
}
