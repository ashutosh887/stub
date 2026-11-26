import { ConsoleShell } from "@/components/app-tabs";
import { AdminLogin } from "@/components/admin-login";
import { ConsoleHeader, Empty, LedgerSection } from "@/components/console-kit";
import { adminPageAllowed } from "@/lib/api";
import { type AttributionRow, listAttribution } from "@/lib/data";
import { formatUsd } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cost attribution and chargeback",
  description:
    "Break agent spend down by cost center, team, and vendor to answer chargeback and showback questions a cloud bill cannot.",
  alternates: { canonical: "/attribution" },
};

const LINK =
  "text-fg underline decoration-brand-dim underline-offset-4 transition-colors hover:decoration-brand";

export default async function AttributionPage() {
  if (!(await adminPageAllowed())) return <AdminLogin />;

  const [byCostCenter, byTeam, byVendor] = await Promise.all([
    listAttribution("costCenter"),
    listAttribution("team"),
    listAttribution("vendor"),
  ]);

  const total = byCostCenter.reduce((sum, r) => sum + r.totalMicro, 0n);

  return (
    <ConsoleShell tab="attribution">
      <ConsoleHeader
        title="Where the money went"
        note={
          <>
            Journal lines import into QuickBooks or NetSuite.
            <a href="/api/export/journal" className={`mt-3 block w-fit ${LINK}`}>
              Export journal CSV
            </a>
          </>
        }
        intro="Every spend carries the cost center it belongs to. Finance can see which team or customer drove the spend, and which vendor it went to."
      />

      <LedgerSection title="Total attributed" note="Committed spend across every cost center.">
        <p className="w-fit border-b-[3px] border-double border-fg-mute pb-0.5 font-display text-[2.8rem] font-medium leading-none tracking-[-0.02em] text-fg [font-variant-numeric:lining-nums_tabular-nums] sm:text-[3.4rem]">
          {formatUsd(total)}
        </p>
      </LedgerSection>

      <Rollup
        title="By cost center"
        note="The cost center tag sent with each spend."
        rows={byCostCenter}
      />
      <Rollup title="By team" note="Agents roll up into the team above them." rows={byTeam} />
      <Rollup title="By vendor" note="Who got paid." rows={byVendor} />
    </ConsoleShell>
  );
}

function Rollup({ title, note, rows }: { title: string; note: string; rows: AttributionRow[] }) {
  return (
    <LedgerSection title={title} note={note}>
      {rows.length === 0 ? (
        <Empty>No spend booked yet.</Empty>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li
              key={r.label}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3.5rem_7rem]"
            >
              <span className="truncate text-[15px] text-fg">{r.label}</span>
              <div className="order-last col-span-2 h-1.5 bg-line sm:order-none sm:col-span-1">
                <div
                  className="h-full bg-brand transition-[width] duration-500"
                  style={{ width: `${Math.min(r.pct, 100)}%` }}
                />
              </div>
              <span className="tabular hidden text-right text-xs text-fg-mute sm:block">
                {r.pct}%
              </span>
              <span className="tabular text-right text-[15px] text-fg">
                {formatUsd(r.totalMicro)}
                <span className="ml-2 text-xs text-fg-mute sm:hidden">{r.pct}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </LedgerSection>
  );
}
