import { SiteNav } from "@/components/site-nav";
import { AppTabs } from "@/components/app-tabs";
import { AdminLogin } from "@/components/admin-login";
import { IncidentReplay } from "@/components/incident-replay";
import { adminPageAllowed } from "@/lib/api";
import { SCENARIOS } from "@/lib/incidents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function IncidentPage() {
  if (!(await adminPageAllowed())) return <AdminLogin />;

  return (
    <>
      <SiteNav current="dashboard" />
      <AppTabs current="incident" />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header>
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fg-mute">
            Live on Aurora DSQL
          </span>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg">
            Incident replay
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
            Real fleets have burned hundreds to thousands of dollars overnight when an agent fell
            into a loop. Pick a documented runaway pattern and unleash it against a Stub budget,
            then watch the cap hold while the overspend is refused, transaction by transaction.
          </p>
        </header>

        <div className="mt-8">
          <IncidentReplay scenarios={SCENARIOS} />
        </div>

        <p className="mt-8 max-w-2xl text-xs leading-relaxed text-fg-mute">
          Each replay runs in throwaway accounts on the real cluster and self-cleans, so your ledger
          is never touched. The blocked dollars are what Stub refused in this run; the headline
          figures are documented real-world incidents, with a source linked on each scenario.
        </p>
      </main>
    </>
  );
}
