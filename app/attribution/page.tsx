import { SiteNav } from "@/components/site-nav";
import { AppTabs } from "@/components/app-tabs";
import { AdminLogin } from "@/components/admin-login";
import { adminPageAllowed } from "@/lib/api";
import { type AttributionRow, listAttribution } from "@/lib/data";
import { formatUsd } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AttributionPage() {
  if (!(await adminPageAllowed())) return <AdminLogin />;

  const [byCostCenter, byTeam, byVendor] = await Promise.all([
    listAttribution("costCenter"),
    listAttribution("team"),
    listAttribution("vendor"),
  ]);

  const total = byCostCenter.reduce((sum, r) => sum + r.totalMicro, 0n);

  return (
    <>
      <SiteNav current="dashboard" />
      <AppTabs current="attribution" />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-fg-mute">
              Chargeback &amp; showback
            </span>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg">
              Where the money went
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
              Every spend carries the cost center it belongs to, so finance can answer the two
              questions cloud bills can&apos;t: which team or customer drove the spend, and on what.
            </p>
          </div>
          <a
            href="/api/export/journal"
            className="rounded-md border border-line px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-fg-mute transition-colors hover:border-line-bright hover:text-fg"
          >
            Export journal CSV ↓
          </a>
        </header>

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-fg-mute">
            Total attributed spend
          </div>
          <div className="tabular mt-1 text-3xl font-semibold text-fg">{formatUsd(total)}</div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Rollup title="By cost center" rows={byCostCenter} />
          <Rollup title="By team" rows={byTeam} />
          <Rollup title="By vendor" rows={byVendor} />
        </div>
      </main>
    </>
  );
}

function Rollup({ title, rows }: { title: string; rows: AttributionRow[] }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">{title}</h2>
      <div className="mt-4 flex flex-col gap-3">
        {rows.length === 0 && (
          <div className="py-6 text-center text-sm text-fg-mute">No spend recorded yet.</div>
        )}
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm text-fg">{r.label}</span>
              <span className="tabular shrink-0 text-sm text-fg-dim">{formatUsd(r.totalMicro)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-500"
                  style={{ width: `${Math.min(r.pct, 100)}%` }}
                />
              </div>
              <span className="tabular w-12 shrink-0 text-right text-[11px] text-fg-mute">
                {r.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
