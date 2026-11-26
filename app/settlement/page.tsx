import { ConsoleShell } from "@/components/app-tabs";
import { AdminLogin } from "@/components/admin-login";
import { SettlementDemo } from "@/components/settlement-demo";
import { ConsoleHeader, Empty, LedgerSection, utcStamp } from "@/components/console-kit";
import { NumberedStep } from "@/components/site-kit";
import { adminPageAllowed } from "@/lib/api";
import { listAccounts, listReservations } from "@/lib/data";
import { formatUsd } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reserve, pay, settle",
  description:
    "The exactly-once settlement flow: hold an estimate against the budget, pay once, then settle the real cost and refund the difference.",
  alternates: { canonical: "/settlement" },
};

const STATUS: Record<string, { label: string; tone: string }> = {
  held: { label: "Held", tone: "text-warn" },
  settled: { label: "Settled", tone: "text-commit" },
  released: { label: "Released", tone: "text-fg-mute" },
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
    <ConsoleShell tab="settlement">
      <ConsoleHeader
        title="Reserve, pay, settle"
        note="Settle and release each happen once, enforced on the reservation row."
        intro="An agent rarely knows the exact cost before a call. Stub holds the estimate against the cap, books the real cost when it comes back and refunds the rest. A retried settle can't charge the vendor twice, because the database lets a reservation settle once."
      />

      <LedgerSection title="The flow" note="Three steps, one hold, one payment.">
        <ol className="grid gap-7 md:grid-cols-3 md:gap-8">
          <NumberedStep n={1} head="Reserve">
            The estimate is held against every cap up the budget tree in one transaction, so held
            money can&apos;t be spent twice.
          </NumberedStep>
          <NumberedStep n={2} head="Pay">
            The agent makes the paid call. The real cost comes back, often lower than the estimate.
          </NumberedStep>
          <NumberedStep n={3} head="Settle">
            Stub books the real amount as two journal lines and refunds the unused hold. A second
            settle changes nothing.
          </NumberedStep>
        </ol>
      </LedgerSection>

      <LedgerSection
        id="lifecycle"
        title="Try it"
        note="Reserve an estimate, then settle the real cost or release the hold."
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <SettlementDemo budgets={budgets} vendors={vendors} />
          </div>

          <div className="min-w-0">
            <h3 className="text-[13px] text-fg-mute">Recent reservations</h3>
            {reservations.length === 0 ? (
              <Empty>No reservations yet. Reserve one and it shows up here.</Empty>
            ) : (
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {reservations.map((r) => {
                  const status = STATUS[r.status] ?? { label: r.status, tone: "text-fg-dim" };
                  return (
                    <li
                      key={r.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[15px] text-fg">
                          {r.intent ?? "reservation"}
                        </div>
                        <div className="truncate text-[13px] text-fg-mute">
                          {r.budgetName} to {r.vendorName}
                          <span className="tabular">, {utcStamp(r.createdAt)} UTC</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-[15px] text-fg">
                          {r.status === "settled" && r.settledMicro != null
                            ? formatUsd(r.settledMicro)
                            : formatUsd(r.heldMicro)}
                        </div>
                        <div className={`text-xs ${status.tone}`}>{status.label}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </LedgerSection>
    </ConsoleShell>
  );
}
