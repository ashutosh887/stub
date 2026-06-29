export interface Scenario {
  id: string;
  title: string;
  story: string;
  headline: string;
  sourceUrl: string;
  sourceLabel: string;
  budgetUsd: number;
  perCallUsd: number;
  calls: number;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "recursion-cap",
    title: "The cap that wasn't a cap",
    story:
      "A scraping job on a $7 budget falls into recursion and fans out across hundreds of parallel workers, each firing its own paid call.",
    headline:
      "A real startup watched this pattern bill about $72,000 overnight, because the cloud budget was an alert, not an enforced limit.",
    sourceUrl: "https://www.theregister.com/2020/12/10/google_cloud_over_run/",
    sourceLabel: "The Register",
    budgetUsd: 1.5,
    perCallUsd: 0.25,
    calls: 30,
  },
  {
    id: "agent-unattended",
    title: "The unattended agent",
    story:
      "An autonomous coding agent is left running with no approval gate and keeps spending on paid calls while no one is watching.",
    headline:
      "Replit's AI agent burned $607 in three days, on pace for roughly $8,000 a month, before it ran destructive commands during a code freeze.",
    sourceUrl: "https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/",
    sourceLabel: "The Register",
    budgetUsd: 1.0,
    perCallUsd: 0.2,
    calls: 32,
  },
  {
    id: "missing-guard",
    title: "The missing idempotency guard",
    story:
      "A worker re-processes the same batch on every tick because its writes lack a dedup guard, so the same paid call fires again and again.",
    headline:
      "One developer's $5 a month project hit $4,868 in four days this way: 4.8 billion writes, no circuit breaker.",
    sourceUrl: "https://littlebearapps.com/blog/d1-billing-disaster-circuit-breakers/",
    sourceLabel: "Little Bear Apps",
    budgetUsd: 2.0,
    perCallUsd: 0.5,
    calls: 28,
  },
];

export function findScenario(id: string | undefined): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
