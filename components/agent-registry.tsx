"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-mute">
          Agent name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="research-agent"
            className="w-44 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-mute">
          Budget account
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={create}
          disabled={working || !name.trim()}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
        >
          {working ? "…" : "Issue key"}
        </button>
      </div>

      {error && <p className="text-xs text-deny">{error}</p>}

      {newKey && (
        <div className="rounded-lg border border-commit-dim bg-commit-dim/10 px-3 py-2.5">
          <div className="text-xs text-fg-dim">
            Copy this key now. It won&apos;t be shown again.
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="tabular flex-1 truncate rounded bg-ink px-2 py-1 text-xs text-fg">
              {newKey}
            </code>
            <button
              onClick={copyKey}
              className="rounded border border-line px-2 py-1 text-xs text-fg-dim hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col divide-y divide-line">
        {agents.length === 0 && (
          <div className="py-6 text-center text-sm text-fg-mute">No agents registered yet.</div>
        )}
        {agents.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm text-fg">{a.name}</div>
              <div className="truncate text-xs text-fg-mute">{a.accountName ?? "no account"}</div>
            </div>
            <code className="tabular shrink-0 text-xs text-fg-mute">
              {a.keyPreview ? `stub_sk_…${a.keyPreview}` : "no key"}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
