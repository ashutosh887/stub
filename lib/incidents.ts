export interface Scenario {
  id: string;
  title: string;
  story: string;
  headline: string;
  budgetUsd: number;
  perCallUsd: number;
  calls: number;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "doc-loop",
    title: "The overnight summarizer loop",
    story:
      "A document-summarizer agent slips into a recursive cycle and fires the same paid call over and over while everyone sleeps.",
    headline:
      "In the wild this pattern burned ~$437 across 14,000 redundant calls before a quota tripped.",
    budgetUsd: 1.5,
    perCallUsd: 0.25,
    calls: 30,
  },
  {
    id: "cfn-loop",
    title: "The retry storm",
    story:
      "An infra agent hits an error and retries by spinning up a fresh paid resource each time — a loop that never converges.",
    headline: "A real agent ran up a $6,531 cloud bill this way, re-provisioning on every failure.",
    budgetUsd: 2.0,
    perCallUsd: 0.5,
    calls: 28,
  },
  {
    id: "api-storm",
    title: "The weekend API storm",
    story:
      "A coding agent is left running unattended and hammers a paid API far past any sane rate over a long weekend.",
    headline:
      "One documented storm reached 847,000 calls and ~$3,847 before the account was suspended.",
    budgetUsd: 1.0,
    perCallUsd: 0.2,
    calls: 32,
  },
];

export function findScenario(id: string | undefined): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
