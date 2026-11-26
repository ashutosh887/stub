import { ConsoleShell } from "@/components/app-tabs";
import { AdminLogin } from "@/components/admin-login";
import { ConsoleHeader } from "@/components/console-kit";
import { IncidentReplay } from "@/components/incident-replay";
import { adminPageAllowed } from "@/lib/api";
import { SCENARIOS } from "@/lib/incidents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Incident replay",
  description:
    "Replay documented runaway-agent spend patterns against an enforced cap and watch the overspend get refused, transaction by transaction.",
  alternates: { canonical: "/incident" },
};

export default async function IncidentPage() {
  if (!(await adminPageAllowed())) return <AdminLogin />;

  return (
    <ConsoleShell tab="incident">
      <ConsoleHeader
        title="Incident replay"
        note="Refused dollars are from this run. Headline figures are from the linked sources."
        intro="Agents stuck in a loop have run up bills overnight because nothing stopped the next call. Pick one of those patterns, run it against a Stub budget, and watch each call past the cap get refused."
      />
      <IncidentReplay scenarios={SCENARIOS} />
    </ConsoleShell>
  );
}
