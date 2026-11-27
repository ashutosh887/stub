import { BLOG_URL, DESCRIPTION, FAQS, GITHUB_URL, NPM_URL, SITE_URL, TITLE } from "@/config/seo";
import { raceSentences } from "@/lib/race";

export const dynamic = "force-static";

const BLOB = `${GITHUB_URL}/blob/main`;

function body(): string {
  const race = raceSentences();
  return [
    `# ${TITLE}`,
    "",
    `> ${DESCRIPTION}`,
    "",
    "Stub sits between a fleet of AI agents and the money they spend. Every spend is one double-entry transaction that debits a budget and credits a vendor, walks the budget hierarchy and checks policy, velocity and the kill switch before it commits.",
    "",
    "## How the budget holds",
    "",
    "- `CHECK (balance_micro >= 0)` and `CHECK (cap_micro IS NULL OR balance_micro <= cap_micro)` refuse a write below zero or above its cap with SQLSTATE 23514, whichever role or code path sends it. A 23514 that reaches the app is recorded as a `db_refused` denial.",
    "- Concurrent writers in either Region are ordered by Aurora DSQL's optimistic concurrency control. The loser gets SQLSTATE 40001, and Stub retries against the fresh balance or records a denial.",
    "- The app connects as `stub_app`, which cannot update or delete ledger entries or change the schema (SQLSTATE 42501), using short-lived IAM credentials over Vercel OIDC. No AWS keys are stored.",
    `- Ten writers that skip the app's check race a budget on Aurora DSQL. ${race.before} ${race.after}`,
    `- Anyone can send those statements to production as the app's own role on [the proof page](${SITE_URL}/proof). Each runs inside its own transaction and is rolled back.`,
    "",
    "## Install",
    "",
    "```bash",
    "npm install trystub",
    "```",
    "",
    "```ts",
    'import { StubClient } from "trystub";',
    "const stub = new StubClient({ apiKey: process.env.STUB_API_KEY, baseUrl: process.env.STUB_URL });",
    'if (await stub.guard({ vendorAccountId, amountUsd: 0.02, intent: "fetch market data" })) {',
    "  await doThePaidThing();",
    "}",
    "```",
    "",
    "## Pages",
    "",
    `- [Home](${SITE_URL}): what Stub is and what the review changed`,
    `- [How it works](${SITE_URL}/how-it-works): the spend transaction and the constraints that refuse an overspend`,
    `- [Proof](${SITE_URL}/proof): the race chart and the live database refusal`,
    `- [Operator console](${SITE_URL}/dashboard): the live ledger console; production opens it only with the operator's token, and it opens without one on local Postgres`,
    "",
    "## Sources",
    "",
    `- [Source code](${GITHUB_URL}) (MIT)`,
    `- [SDK on npm](${NPM_URL})`,
    `- [Measurements](${BLOB}/measurements/wa-review/RESULTS.md): every number on the site, with how it was measured`,
    `- [Database guardrail GitHub Action](${GITHUB_URL}/tree/main/.github/actions/db-guardrail): run the same refusal probes against your own Postgres or Aurora DSQL in CI`,
    `- [Schema](${BLOB}/db/schema.sql) and [app role grants](${BLOB}/db/app-role.sql)`,
    `- [Build notes](${BLOG_URL})`,
    "",
    "## FAQ",
    "",
    ...FAQS.flatMap((faq) => [`### ${faq.question}`, "", faq.answer, ""]),
  ].join("\n");
}

export function GET(): Response {
  return new Response(body(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
