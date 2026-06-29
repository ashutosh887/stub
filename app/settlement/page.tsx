import { SiteNav } from "@/components/site-nav";
import { AppTabs } from "@/components/app-tabs";
import { AdminLogin } from "@/components/admin-login";
import { SettlementDemo } from "@/components/settlement-demo";
import { adminPageAllowed } from "@/lib/api";
import { listAccounts, listReservations } from "@/lib/data";
import { formatUsd } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  held: "text-warn",
  settled: "text-commit",
  released: "text-fg-mute",
};

export default async function SettlementPage() {
  if (!(await adminPageAllowed())) return <AdminLogin />;

  const [accounts, reservations] = await Promise.all([listAccounts(), listReservations(12)]);
  const budgets = accounts
    .filter((a) => a.type === "agent" || a.type === "team")
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const vendors = accounts
    .filter((a) => a.type === "vendor")
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));

  return (
    <>
      <SiteNav current="dashboard" />
      <AppTabs current="settlement" />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header>
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fg-mute">
            Exactly-once
          </span>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg">
            Reserve → pay → settle
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
            Agent costs are estimated, not known up front. Stub holds the estimate against the cap,
            then books the real cost when it lands and refunds the difference — and a retried
            settlement can never double-charge the vendor, because the reservation can be settled
            exactly once under the database&apos;s concurrency control.
          </p>
        </header>

        <ol className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          <Step
            n="01"
            head="Reserve"
            body="The estimated cost is held against the budget hierarchy in one transaction. The cap is enforced now — held funds can't be spent twice."
          />
          <Step
            n="02"
            head="Pay"
            body="Your agent makes the real paid call. The actual cost comes back — often lower than the estimate."
          />
          <Step
            n="03"
            head="Settle"
            body="The reservation books the actual amount as a double-entry line and refunds the unused hold. Settling again is a no-op."
          />
        </ol>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">
              Run the lifecycle
            </h2>
            <p className="mt-1 text-sm text-fg-dim">
              Reserve an estimate, then settle for the actual cost or release it.
            </p>
            <div className="mt-4">
              <SettlementDemo budgets={budgets} vendors={vendors} />
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">
              Recent reservations
            </h2>
            <div className="mt-4 flex flex-col divide-y divide-line">
              {reservations.length === 0 && (
                <div className="py-8 text-center text-sm text-fg-mute">
                  No reservations yet. Reserve one to see it here.
                </div>
              )}
              {reservations.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-fg">{r.intent ?? "reservation"}</div>
                    <div className="text-xs text-fg-mute">
                      {r.budgetName} → {r.vendorName}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular text-sm text-fg-dim">
                      {r.status === "settled" && r.settledMicro != null
                        ? formatUsd(r.settledMicro)
                        : formatUsd(r.heldMicro)}
                    </div>
                    <div className={`text-[11px] uppercase tracking-wide ${STATUS_TONE[r.status]}`}>
                      {r.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function Step({ n, head, body }: { n: string; head: string; body: string }) {
  return (
    <li className="bg-surface p-6">
      <div className="tabular text-sm text-brand">{n}</div>
      <h3 className="mt-3 text-base font-semibold text-fg">{head}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fg-dim">{body}</p>
    </li>
  );
}
