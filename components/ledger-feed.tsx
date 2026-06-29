"use client";

import { useState } from "react";

export interface FeedEntry {
  id: string;
  intent: string;
  accountName: string;
  kind: "debit" | "credit";
  amountLabel: string;
  hash: string;
  prevHash: string;
  agentId: string | null;
  createdAt: string;
  receipt: unknown;
}

export function LedgerFeed({ entries }: { entries: FeedEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-fg-mute">
        No spend recorded yet. Run a simulated spend or the stress test.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-line">
      {entries.map((e) => {
        const open = openId === e.id;
        return (
          <div key={e.id}>
            <button
              onClick={() => setOpenId(open ? null : e.id)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-surface-2/50"
              aria-expanded={open}
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-fg">
                  {e.intent} <span className="text-fg-mute">→ {e.accountName}</span>
                </div>
                <div className="tabular truncate text-xs text-fg-mute">
                  {e.hash.slice(0, 16)}… · {open ? "hide" : "details"}
                </div>
              </div>
              <span
                className={`tabular shrink-0 text-sm ${
                  e.kind === "debit" ? "text-deny" : "text-commit"
                }`}
              >
                {e.amountLabel}
              </span>
            </button>

            {open && (
              <div className="rise space-y-3 pb-4 pl-1 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <Detail label="Agent" value={e.agentId ?? "none"} />
                  <Detail label="Recorded" value={new Date(e.createdAt).toLocaleString()} />
                </div>
                <div className="rounded-lg border border-line bg-ink p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-fg-mute">
                    <span className="h-1.5 w-1.5 rounded-full bg-commit" />
                    Hash chain
                  </div>
                  <div className="tabular mt-2 space-y-1 break-all text-fg-dim">
                    <div>
                      <span className="text-fg-mute">prev </span>
                      {e.prevHash || "genesis"}
                    </div>
                    <div>
                      <span className="text-fg-mute">this </span>
                      {e.hash}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-ink p-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">
                    Payment receipt
                  </div>
                  <pre className="tabular mt-2 overflow-x-auto whitespace-pre-wrap break-words text-fg-dim">
                    {e.receipt
                      ? JSON.stringify(e.receipt, null, 2)
                      : "No receipt captured for this entry."}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-ink px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">{label}</div>
      <div className="mt-0.5 text-fg-dim">{value}</div>
    </div>
  );
}
