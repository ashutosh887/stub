import { SiteNav } from "@/components/site-nav";
import { AppTabs } from "@/components/app-tabs";
import { AdminLogin } from "@/components/admin-login";
import { AuditPanel } from "@/components/audit-panel";
import { adminPageAllowed } from "@/lib/api";
import { auditReport } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  if (!(await adminPageAllowed())) return <AdminLogin />;

  const report = await auditReport();

  return (
    <>
      <SiteNav current="dashboard" />
      <AppTabs current="audit" />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-fg-mute">
              Audit-grade trust
            </span>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg">
              Tamper-evident ledger
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
              Every entry is hash-chained to the one before it, per account. Any altered or removed
              row breaks the chain and is detected. Export the books as accounting journal lines for
              QuickBooks or NetSuite.
            </p>
          </div>
          <a
            href="/api/export/journal"
            className="rounded-md border border-line px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-fg-mute transition-colors hover:border-line-bright hover:text-fg"
          >
            Export journal CSV ↓
          </a>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <AuditPanel
            initial={{
              ok: report.ok,
              entryCount: report.entryCount,
              accountCount: report.accountCount,
              problems: report.problems,
            }}
          />

          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">
              Chain heads
            </h2>
            <p className="mt-1 text-xs text-fg-mute">
              The latest hash for each account&apos;s chain.
            </p>
            <div className="mt-4 flex flex-col divide-y divide-line">
              {report.chains.length === 0 && (
                <div className="py-8 text-center text-sm text-fg-mute">
                  No entries yet. Run some spends to build the chain.
                </div>
              )}
              {report.chains.map((c) => (
                <div key={c.accountId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-fg">{c.accountName}</div>
                    <div className="tabular truncate text-[11px] text-fg-mute">{c.head}</div>
                  </div>
                  <span className="tabular shrink-0 text-xs text-fg-dim">{c.entryCount} lines</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
