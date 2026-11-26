"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BUTTON, Empty, Field, INPUT, Notice } from "@/components/console-kit";
import { FOCUS } from "@/components/site-kit";

interface AccountOption {
  id: string;
  name: string;
  type: string;
}

interface SimResult {
  evaluated: number;
  blocked: number;
  needsApproval: number;
  savedUsd: string;
  reasons: Record<string, number>;
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
  const [sim, setSim] = useState<SimResult | null>(null);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { accountId, label: label.trim() || "Policy" };
    if (capUsd.trim()) {
      body.limitUsd = capUsd.trim();
      if (windowSeconds > 0) body.windowSeconds = windowSeconds;
    }
    if (approvalUsd.trim()) body.approvalThresholdUsd = approvalUsd.trim();
    if (vendorMode === "allow" && vendorIds.length) body.vendorAllow = vendorIds;
    if (vendorMode === "block" && vendorIds.length) body.vendorBlock = vendorIds;
    return body;
  }

  function reset() {
    setLabel("");
    setCapUsd("");
    setWindowSeconds(0);
    setApprovalUsd("");
    setVendorMode("none");
    setVendorIds([]);
    setSim(null);
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody()),
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

  async function dryRun() {
    setBusy(true);
    setError(null);
    setSim(null);
    try {
      const res = await fetch("/api/policies/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "simulation failed");
        return;
      }
      setSim(data as SimResult);
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
    <div className="flex flex-col gap-5">
      {policies.length === 0 ? (
        <Empty>No policies yet. Add one to cap spending, limit vendors or require approval.</Empty>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {policies.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={`text-[15px] ${p.enabled ? "text-fg" : "text-fg-mute line-through"}`}
                  >
                    {p.label || "Policy"}
                  </span>
                  <span className="text-[13px] text-fg-mute">
                    on {p.accountName}
                    {p.enabled ? "" : ", off"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.limitUsd && (
                    <Chip>
                      ≤ ${p.limitUsd} {windowLabel(p.windowSeconds)}
                    </Chip>
                  )}
                  {p.approvalUsd && <Chip tone="warn">approval over ${p.approvalUsd}</Chip>}
                  {p.vendorAllow?.length ? (
                    <Chip>only {p.vendorAllow.map(vendorName).join(", ")}</Chip>
                  ) : null}
                  {p.vendorBlock?.length ? (
                    <Chip tone="deny">blocks {p.vendorBlock.map(vendorName).join(", ")}</Chip>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => toggle(p.id, !p.enabled)} className={BUTTON.quiet}>
                  {p.enabled ? "Turn off" : "Turn on"}
                </button>
                <button
                  onClick={() => remove(p.id)}
                  className={`${BUTTON.quiet} hover:bg-deny/10 hover:text-deny`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button onClick={() => setOpen(true)} className={`${BUTTON.secondary} self-start`}>
          Add a policy
        </button>
      ) : (
        <div className="rounded-md border border-line-bright bg-surface p-5">
          <h3 className="font-display text-xl font-medium text-fg">New policy</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Applies to">
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={INPUT}
              >
                {budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <Input value={label} onChange={setLabel} placeholder="Daily ceiling" />
            </Field>
            <Field label="Cap in USD">
              <Input value={capUsd} onChange={setCapUsd} placeholder="10.00" inputMode="decimal" />
            </Field>
            <Field label="Window">
              <select
                value={String(windowSeconds)}
                onChange={(e) => setWindowSeconds(Number(e.target.value))}
                className={INPUT}
              >
                {WINDOWS.map((w) => (
                  <option key={w.seconds} value={w.seconds}>
                    {w.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Require approval over, in USD">
              <Input
                value={approvalUsd}
                onChange={setApprovalUsd}
                placeholder="5.00"
                inputMode="decimal"
              />
            </Field>
            <Field label="Vendors">
              <select
                value={vendorMode}
                onChange={(e) => setVendorMode(e.target.value as typeof vendorMode)}
                className={INPUT}
              >
                <option value="none">Any vendor</option>
                <option value="allow">Only the ones selected</option>
                <option value="block">Block the ones selected</option>
              </select>
            </Field>
          </div>

          {vendorMode !== "none" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {vendors.map((v) => {
                const on = vendorIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    aria-pressed={on}
                    onClick={() =>
                      setVendorIds((ids) => (on ? ids.filter((i) => i !== v.id) : [...ids, v.id]))
                    }
                    className={`rounded-md border px-3 py-1.5 text-[13px] transition-colors ${FOCUS} ${
                      on
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-line-bright text-fg-dim hover:border-fg-mute"
                    }`}
                  >
                    {v.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button onClick={create} disabled={busy || !accountId} className={BUTTON.primary}>
              {busy ? "Saving…" : "Save policy"}
            </button>
            <button onClick={dryRun} disabled={busy || !accountId} className={BUTTON.secondary}>
              Replay past spend
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
                reset();
              }}
              className={BUTTON.quiet}
            >
              Cancel
            </button>
          </div>

          {sim && (
            <div className="mt-4">
              {sim.evaluated === 0 ? (
                <Notice tone="warn">This account has no past spend to replay yet.</Notice>
              ) : (
                <Notice tone="commit">
                  <span className="text-fg-dim">
                    Replayed {sim.evaluated} past spend{sim.evaluated === 1 ? "" : "s"}.{" "}
                    <span className="text-deny">{sim.blocked} blocked</span>
                    {sim.needsApproval > 0 && (
                      <>
                        , <span className="text-warn">{sim.needsApproval} held for approval</span>
                      </>
                    )}
                    . It would have saved{" "}
                    <span className="tabular text-commit">${sim.savedUsd}</span>.
                  </span>
                </Notice>
              )}
            </div>
          )}
          {error && (
            <div className="mt-4">
              <Notice tone="deny">{error}</Notice>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warn" | "deny";
}) {
  const cls =
    tone === "deny"
      ? "border-deny-dim text-deny"
      : tone === "warn"
        ? "border-brand-dim text-warn"
        : "border-line-bright text-fg-dim";
  return (
    <span className={`tabular rounded-sm border px-1.5 py-0.5 text-xs ${cls}`}>{children}</span>
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
      className={`${inputMode ? "tabular " : ""}${INPUT}`}
    />
  );
}
