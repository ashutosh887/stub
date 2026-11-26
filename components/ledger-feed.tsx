"use client";

import { Fragment, useState } from "react";
import { utcStamp } from "@/components/console-kit";
import { FOCUS } from "@/components/site-kit";

export interface FeedEntry {
  id: string;
  transactionId: string;
  intent: string;
  accountName: string;
  kind: "debit" | "credit";
  amount: string;
  hash: string;
  prevHash: string;
  agentId: string | null;
  createdAt: string;
  receipt: unknown;
}

interface Transaction {
  id: string;
  intent: string;
  createdAt: string;
  lines: FeedEntry[];
}

function group(entries: FeedEntry[]): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const e of entries) {
    const txn = byId.get(e.transactionId);
    if (txn) {
      txn.lines.push(e);
    } else {
      byId.set(e.transactionId, {
        id: e.transactionId,
        intent: e.intent,
        createdAt: e.createdAt,
        lines: [e],
      });
    }
  }
  for (const txn of byId.values()) {
    txn.lines.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "debit" ? -1 : 1));
  }
  return [...byId.values()];
}

export function LedgerFeed({ entries }: { entries: FeedEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <p className="py-6 text-sm text-fg-mute">
        Nothing booked yet. Try a spend above and its two lines land here.
      </p>
    );
  }

  return (
    <div className="max-h-[38rem] overflow-auto rounded-md border border-line-bright bg-surface">
      <table className="w-full min-w-[40rem] table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[13px] text-fg-mute">
          <tr className="border-b border-line-bright">
            <th scope="col" className="w-[7.5rem] px-4 py-2.5 font-normal">
              UTC
            </th>
            <th scope="col" className="px-2 py-2.5 font-normal">
              Account and memo
            </th>
            <th scope="col" className="w-[6.5rem] px-2 py-2.5 text-right font-normal">
              Debit
            </th>
            <th scope="col" className="w-[6.5rem] px-2 py-2.5 text-right font-normal">
              Credit
            </th>
            <th scope="col" className="w-[7.5rem] px-4 py-2.5 font-normal">
              Hash
            </th>
          </tr>
        </thead>
        <tbody>
          {group(entries).map((txn) => (
            <Fragment key={txn.id}>
              <tr className="border-t border-line first:border-t-0">
                <td className="tabular px-4 pt-3 pb-1 align-baseline text-xs text-fg-mute">
                  {utcStamp(txn.createdAt)}
                </td>
                <td colSpan={4} className="px-2 pt-3 pb-1 align-baseline text-fg">
                  {txn.intent}
                </td>
              </tr>
              {txn.lines.map((e, i) => {
                const open = openId === e.id;
                const last = i === txn.lines.length - 1;
                return (
                  <Fragment key={e.id}>
                    <tr className={open ? "bg-surface-2" : ""}>
                      <td />
                      <td
                        className={`truncate px-2 py-1 text-fg-dim ${e.kind === "credit" ? "pl-8" : ""} ${last ? "pb-3" : ""}`}
                      >
                        {e.accountName}
                      </td>
                      <td className={`tabular px-2 py-1 text-right text-fg ${last ? "pb-3" : ""}`}>
                        {e.kind === "debit" ? e.amount : ""}
                      </td>
                      <td className={`tabular px-2 py-1 text-right text-fg ${last ? "pb-3" : ""}`}>
                        {e.kind === "credit" ? e.amount : ""}
                      </td>
                      <td className={`px-4 py-1 ${last ? "pb-3" : ""}`}>
                        <button
                          onClick={() => setOpenId(open ? null : e.id)}
                          aria-expanded={open}
                          aria-label={`Receipt and chain link for ${e.accountName}`}
                          className={`tabular rounded-sm text-xs text-fg-mute underline decoration-line-bright underline-offset-4 transition-colors hover:text-brand hover:decoration-brand-dim ${FOCUS}`}
                        >
                          {e.hash.slice(0, 8)}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-surface-2">
                        <td colSpan={5} className="px-4 pt-1 pb-4">
                          <Detail entry={e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ entry }: { entry: FeedEntry }) {
  return (
    <div className="rise grid gap-4 text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <dl className="tabular space-y-1.5 break-all text-fg-dim">
        <div>
          <dt className="inline text-fg-mute">prev </dt>
          <dd className="inline">{entry.prevHash || "genesis"}</dd>
        </div>
        <div>
          <dt className="inline text-fg-mute">this </dt>
          <dd className="inline text-fg">{entry.hash}</dd>
        </div>
        <div>
          <dt className="inline text-fg-mute">agent </dt>
          <dd className="inline">{entry.agentId ?? "none"}</dd>
        </div>
        <div>
          <dt className="inline text-fg-mute">booked </dt>
          <dd className="inline">{entry.createdAt}</dd>
        </div>
      </dl>
      <div className="min-w-0">
        <div className="text-fg-mute">Payment receipt</div>
        <pre className="tabular mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words text-fg-dim">
          {entry.receipt ? JSON.stringify(entry.receipt, null, 2) : "No receipt on this line."}
        </pre>
      </div>
    </div>
  );
}
