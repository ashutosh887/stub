"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BUTTON, Empty, Field, INPUT, Notice } from "@/components/console-kit";

export interface AgentView {
  id: string;
  name: string;
  accountName: string | null;
  keyPreview: string | null;
  createdAt: string;
}

interface BudgetOption {
  id: string;
  name: string;
  type: string;
}

export function AgentRegistry({
  agents,
  budgets,
}: {
  agents: AgentView[];
  budgets: BudgetOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(budgets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    if (!name.trim() || !accountId) return;
    setBusy(true);
    setError(null);
    setNewKey(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "could not create agent");
      setNewKey(data.apiKey as string);
      setName("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const working = busy || pending;

  return (
    <div className="flex flex-col gap-5">
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Field label="Agent name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="research-agent"
            className={INPUT}
          />
        </Field>
        <Field label="Budget it spends from">
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
        <button type="submit" disabled={working || !name.trim()} className={BUTTON.secondary}>
          {working ? "Issuing…" : "Issue key"}
        </button>
      </form>

      {error && <Notice tone="deny">{error}</Notice>}

      {newKey && (
        <Notice tone="commit">
          <p className="text-fg-dim">Copy this key now. Stub stores only its hash.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="tabular min-w-0 flex-1 truncate rounded-sm bg-ink px-2 py-1.5 text-xs text-fg">
              {newKey}
            </code>
            <button onClick={copyKey} className={BUTTON.quiet}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </Notice>
      )}

      {agents.length === 0 ? (
        <Empty>No agents yet. Issue a key above and the agent appears here.</Empty>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {agents.map((a) => (
            <li
              key={a.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] text-fg">{a.name}</div>
                <div className="truncate text-[13px] text-fg-mute">
                  {a.accountName ? `spends from ${a.accountName}` : "no budget"}
                </div>
              </div>
              <code className="tabular shrink-0 text-xs text-fg-mute">
                {a.keyPreview ? `stub_sk_…${a.keyPreview}` : "no key"}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
