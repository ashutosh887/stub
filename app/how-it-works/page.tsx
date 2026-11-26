import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import {
  CodeBlock,
  Mono,
  NumberedStep,
  PrimaryLink,
  SecondaryLink,
  SiteSection,
  TextLink,
  repoFile,
  type Citation,
} from "@/components/site-kit";

export const dynamic = "force-static";

export const metadata = {
  title: "How Stub works",
  description:
    "How Stub keeps one budget for a fleet of AI agents: a double-entry ledger on Aurora DSQL, CHECK constraints that refuse a balance below zero or above its cap, and a database role that cannot rewrite the ledger.",
  alternates: { canonical: "/how-it-works" },
};

interface Concept {
  title: string;
  body: React.ReactNode;
  cites: Citation[];
}

const CONCEPTS: Concept[] = [
  {
    title: "One budget for the whole fleet",
    body: "You set one company-wide budget and split it into teams and agents. A spend is bound by the tightest cap on its chain: agent, then team, then org. Every ancestor balance moves in the same transaction, before any money does.",
    cites: [repoFile("core/ledger.ts")],
  },
  {
    title: "Every spend is double entry",
    body: "A spend debits the agent's budget and credits the vendor in one atomic transaction. Entries are append-only and each carries the hash of the one before it, so the table is its own tamper-evident audit log.",
    cites: [repoFile("core/hash.ts"), repoFile("core/audit.ts")],
  },
  {
    title: "Two agents, one dollar: 40001",
    body: "When two agents race for the same balance, Aurora DSQL's optimistic concurrency control commits one and returns SQLSTATE 40001 to the other. Stub retries the loser against the fresh balance or records a denial. There is no moment when an overspend is briefly real, in either Region.",
    cites: [repoFile("core/ledger.ts"), repoFile("test/live/cross-region.test.ts")],
  },
  {
    title: "Below zero or over the cap: 23514",
    body: (
      <>
        Accounts carry <Mono>CHECK (balance_micro &gt;= 0)</Mono> and{" "}
        <Mono>CHECK (cap_micro IS NULL OR balance_micro &lt;= cap_micro)</Mono>. Every shard of a
        sharded balance carries the first one. The cap covers the sum of the shards, which a check
        on one row cannot see. The database answers a write that breaks either constraint with
        SQLSTATE 23514, whoever sends it: the app, a migration script, a hotfix that forgot the
        check, or the admin. If a refusal reaches Stub&apos;s own spend or reserve path, it comes
        back as a denial with reason <Mono>db_refused</Mono> and is recorded like any other, so the
        audit trail shows it.
      </>
    ),
    cites: [repoFile("db/schema.sql"), repoFile("scripts/migrate.ts"), repoFile("core/ledger.ts")],
  },
  {
    title: "The app can't rewrite its own history: 42501",
    body: (
      <>
        The app connects as <Mono>stub_app</Mono>, never as admin. That role can append entries and
        move balances. It cannot update or delete an entry, create or drop a table, or create an
        account, and each attempt fails with SQLSTATE 42501. It signs in through Vercel OIDC with
        one-hour sessions and an IAM role allowed only <Mono>dsql:DbConnect</Mono>.
      </>
    ),
    cites: [repoFile("db/app-role.sql"), repoFile("infra/stub-app-role.yaml")],
  },
  {
    title: "Policy runs on every spend",
    body: "Per-transaction caps, rolling-window limits, vendor allow and block lists and approval thresholds are checked inside the same transaction. A velocity breaker freezes a runaway agent, and a kill switch freezes one agent or the whole fleet.",
    cites: [repoFile("core/policy.ts")],
  },
  {
    title: "Paying exactly once",
    body: "For a payment that can't be undone, Stub reserves the amount first, the agent pays once outside the transaction, then Stub settles the real cost and refunds the difference. Settle and release each happen once, and a sweeper reclaims holds left behind by a crash.",
    cites: [repoFile("core/settlement.ts")],
  },
  {
    title: "Tokens are spend too",
    body: "The SDK meters LLM calls through the same budget. It holds an estimate, runs the call once, then settles the real token cost. It reads OpenAI and Anthropic usage, and you supply the rates, because a price table shipped inside a package goes stale and bills you wrong.",
    cites: [repoFile("sdk/llm.ts")],
  },
  {
    title: "Ask the ledger in plain English",
    body: "Ask how much Marketing's agents spent on data APIs and the model fills in a constrained, parameterized query over the ledger. It never writes SQL against your data, and a built-in parser answers when the model is unavailable.",
    cites: [repoFile("core/query.ts")],
  },
];

export default function HowItWorks() {
  return (
    <>
      <SiteNav current="how" />

      <header className="mx-auto max-w-6xl px-4 pt-14 pb-14 sm:px-6 sm:pt-20 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-12">
        <div className="lg:col-start-2">
          <h1 className="max-w-3xl font-display text-[2.6rem] font-medium leading-[1.04] tracking-[-0.03em] text-fg sm:text-6xl">
            A budget the database refuses to break.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fg-dim">
            Stub sits between your agents and the money they spend. Each spend is a double-entry
            transaction, and three refusals from the database keep the budget and its record whole.
            Here is the whole design, with the file that enforces each part beside it.
          </p>
        </div>
      </header>

      <div className="border-t border-line">
        {CONCEPTS.map((concept) => (
          <article
            key={concept.title}
            className="mx-auto grid max-w-6xl gap-y-4 border-b border-line px-4 py-10 last:border-b-0 sm:px-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-12"
          >
            <div className="min-w-0 lg:col-start-2">
              <h2 className="font-display text-[1.65rem] font-medium leading-tight tracking-[-0.015em] text-fg">
                {concept.title}
              </h2>
              <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-fg-dim">
                {concept.body}
              </p>
            </div>
            <ul className="margin-rule flex flex-wrap gap-x-4 gap-y-1 lg:col-start-1 lg:row-start-1 lg:block lg:space-y-1.5 lg:border-r-[3px] lg:pt-2 lg:pr-6">
              {concept.cites.map((cite) => (
                <li key={cite.href} className="min-w-0">
                  <a
                    href={cite.href}
                    target="_blank"
                    rel="noreferrer"
                    className="break-words font-mono text-[13px] text-fg-mute transition-colors hover:text-brand"
                  >
                    {cite.label}
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <SiteSection
        title="Try it in a minute."
        intro="The dashboard runs on a live Aurora DSQL cluster with sample data. Nothing you do there spends real money."
        cites={[
          { label: "/dashboard", href: "/dashboard" },
          { label: "/proof", href: "/proof" },
        ]}
      >
        <ol className="max-w-2xl space-y-6">
          <NumberedStep n={1} head="Run a spend">
            In Simulate a spend, authorize a small amount. It commits and shows up in the ledger.
          </NumberedStep>
          <NumberedStep n={2} head="Trip a limit">
            Authorize more than an agent has left. It is denied and recorded, and the balance holds.
          </NumberedStep>
          <NumberedStep n={3} head="Ask the ledger">
            Type a question into Ask your ledger and read an answer drawn from the entries.
          </NumberedStep>
          <NumberedStep n={4} head="Go around the app">
            On <TextLink href="/proof">/proof</TextLink>, send the statements a buggy path would
            send and read the SQLSTATE production returns.
          </NumberedStep>
        </ol>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <PrimaryLink href="/dashboard">Open the dashboard</PrimaryLink>
          <SecondaryLink href="/proof">Try to break it</SecondaryLink>
        </div>
      </SiteSection>

      <SiteSection
        title="Drop it into an agent."
        intro="Put the budget gate in front of any paid call. The money moves only after the spend commits."
        cites={[repoFile("sdk/index.ts"), repoFile("sdk/llm.ts"), repoFile("sdk/x402.ts")]}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
          <CodeBlock>{`import { StubClient } from "trystub";

const stub = new StubClient({ apiKey: process.env.STUB_API_KEY });

if (await stub.guard({ vendorAccountId, amountUsd: 0.02, intent: "fetch market data" })) {
  await doThePaidThing();
}`}</CodeBlock>
          <div>
            <p className="max-w-2xl leading-relaxed text-fg-dim">
              For LLM calls, where the cost is known only afterwards, hold an estimate and settle
              the real token spend.
            </p>
            <div className="mt-4">
              <CodeBlock caption="No dependencies. Ships as ESM and CommonJS. Every call has a timeout and bounded retries, and a retried spend resolves to the same ledger entry.">{`import { meterLLM, estimateUsd } from "trystub/llm";

const pricing = { inputPerMTok: 3, outputPerMTok: 15 };

const response = await meterLLM(
  stub,
  { vendorAccountId, pricing, estimatedUsd: estimateUsd(promptTokens, maxOutput, pricing) },
  () => callTheModel(),
);`}</CodeBlock>
            </div>
          </div>
        </div>
      </SiteSection>

      <SiteSection
        title="Run the whole thing locally."
        intro={
          <>
            You don&apos;t need an AWS account. Point Stub at local Postgres and the console, the
            ledger and the CHECK constraints work the same way. Transactions run at{" "}
            <Mono>SERIALIZABLE</Mono>, so plain Postgres raises the same 40001 as Aurora DSQL.{" "}
            <Mono>npm run db:app-role</Mono> creates <Mono>stub_app</Mono> locally too, for the
            42501 refusals.
          </>
        }
        cites={[repoFile("docker-compose.yml"), repoFile("test/local/overspend.test.ts")]}
      >
        <CodeBlock caption="Then run npm run test:local to watch ten agents race one budget.">{`npm run db:up
echo 'DATABASE_URL=postgres://stub:stub@localhost:5432/stub' >> .env
npm run migrate && npm run seed
npm run dev`}</CodeBlock>
      </SiteSection>

      <SiteFooter />
    </>
  );
}
