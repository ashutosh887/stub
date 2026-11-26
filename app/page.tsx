import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import {
  CodeBlock,
  Mono,
  NumberedStep,
  PrimaryLink,
  SecondaryLink,
  SiteSection,
  Stamp,
  TextLink,
  repoFile,
} from "@/components/site-kit";
import { FAQS, GITHUB_URL } from "@/config/seo";
import { PROOF_PROBES } from "@/lib/proof";

export const dynamic = "force-static";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const INCIDENT_URL = "https://www.theregister.com/2020/12/10/google_cloud_over_run/";
const RESULTS_URL = `${GITHUB_URL}/blob/main/measurements/wa-review/RESULTS.md`;
const RESULTS = { label: "RESULTS.md", href: RESULTS_URL };

interface Refusal {
  code: string;
  condition: string;
  refuses: string;
  body: React.ReactNode;
  statement: string;
}

const REFUSALS: Refusal[] = [
  {
    code: "40001",
    condition: "serialization_failure",
    refuses: "A second agent spending the same dollars",
    body: "Every spend updates one balance row. When two agents in two Regions race for it, Aurora DSQL commits one and rolls the other back. Stub retries the loser against the fresh balance, or records a denial.",
    statement: "two writers, one balance",
  },
  {
    code: "23514",
    condition: "check_violation",
    refuses: "A balance below zero or above its cap",
    body: (
      <>
        Two CHECK constraints bound every budget: <Mono>balance_micro &gt;= 0</Mono> and{" "}
        <Mono>balance_micro &lt;= cap_micro</Mono>. A buggy code path, a script or a hotfix that
        skips the app&apos;s own check gets the same refusal. So does the database admin.
      </>
    ),
    statement: "UPDATE accounts SET balance_micro = -1",
  },
  {
    code: "42501",
    condition: "insufficient_privilege",
    refuses: "Rewriting the ledger or the schema",
    body: (
      <>
        The app connects as <Mono>stub_app</Mono>, a role that can add ledger entries but cannot
        rewrite or delete them, and cannot create or drop tables. It signs in with one-hour IAM
        credentials from Vercel OIDC, allowed only <Mono>dsql:DbConnect</Mono>. No keys are stored.
      </>
    ),
    statement: "DELETE FROM entries",
  },
];

const DATABASES = [
  {
    name: "Aurora DSQL",
    writers: "every Region",
    outcome: "one commits, the other gets 40001",
    tone: "text-commit",
    ours: true,
  },
  {
    name: "Aurora PostgreSQL Global",
    writers: "one Region",
    outcome: "all writes go through one primary Region",
    tone: "text-fg-dim",
    ours: false,
  },
  {
    name: "DynamoDB global tables",
    writers: "every Region",
    outcome: "both commit, last writer wins, budget overspent",
    tone: "text-deny",
    ours: false,
  },
];

interface ReviewRow {
  measure: string;
  before: string;
  after: string;
}

const REVIEW: ReviewRow[] = [
  {
    measure: "Balance below zero, as the app's database role",
    before: "accepted",
    after: "refused, 23514",
  },
  { measure: "Balance below zero, as admin", before: "accepted", after: "refused, 23514" },
  {
    measure: "Rewrite or delete a ledger entry, as the app's role",
    before: "accepted",
    after: "refused, 42501",
  },
  {
    measure: "Destructive DSQL actions the app's AWS principal may call",
    before: "6 of 6",
    after: "0 of 6",
  },
  {
    measure: "App's credentials",
    before: "long-lived access key",
    after: "Vercel OIDC, 1-hour sessions",
  },
  {
    measure: "Backup plans covering the ledger",
    before: "0",
    after: "2, daily at 05:00 UTC, 35-day retention",
  },
  { measure: "Restores tested", before: "0", after: "1, verified, 2 min 9 s" },
  {
    measure: "Spend while the primary Region is unreachable",
    before: "fails after 3.0 s",
    after: "committed on us-east-2 in 7.59 s",
  },
  { measure: "CloudTrail trails", before: "0", after: "1, multi-Region" },
  { measure: "GuardDuty detectors", before: "0", after: "2" },
  { measure: "CloudWatch alarms", before: "0", after: "4" },
];

const CAPABILITIES: { group: string; items: { head: string; body: string }[] }[] = [
  {
    group: "Budgets and policy",
    items: [
      {
        head: "Hierarchical budgets",
        body: "Org, team and agent caps, checked together in one transaction. The tightest cap wins.",
      },
      {
        head: "Policy engine",
        body: "Per-transaction and rolling-window caps, vendor allow and block lists, approval over a threshold.",
      },
      {
        head: "Velocity breaker",
        body: "Spend that accelerates past a limit freezes the account on its own.",
      },
      { head: "Kill switch", body: "Freeze one agent or the whole fleet with one call." },
    ],
  },
  {
    group: "Moving money",
    items: [
      {
        head: "Exactly-once settlement",
        body: "Reserve, pay once, settle the real cost. A retry around an irreversible payment can't pay twice.",
      },
      {
        head: "Safe retries",
        body: "Every SDK spend carries an idempotency key, so a retried request lands on the same entry.",
      },
      {
        head: "LLM token metering",
        body: "Hold an estimate, run the call, settle the real token cost. Reads OpenAI and Anthropic usage.",
      },
      {
        head: "Sharded balances",
        body: "Split a hot balance across shards for throughput. Every shard has the same floor at zero.",
      },
    ],
  },
  {
    group: "The record",
    items: [
      {
        head: "Hash-chained entries",
        body: "Each line carries the hash of the one before it, so an edited row breaks the chain.",
      },
      {
        head: "Journal export",
        body: "Download the ledger as accounting journal lines your finance team can import.",
      },
      {
        head: "Cost attribution",
        body: "Tag spend to a team, customer or feature and answer chargeback questions.",
      },
      {
        head: "Ask your ledger",
        body: "Plain-English questions become a parameterized query. The model never writes SQL.",
      },
    ],
  },
];

export default function Home() {
  return (
    <>
      <SiteNav current="home" />

      <header className="relative">
        <div className="mx-auto grid max-w-6xl gap-14 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_27rem] lg:items-end lg:gap-16 lg:pt-28">
          <div className="min-w-0">
            <p className="text-[15px] text-fg-dim">
              The general ledger for AI agent spend, on Amazon Aurora DSQL
            </p>
            <h1 className="mt-5 font-display text-[2.85rem] font-medium leading-[1.02] tracking-[-0.035em] text-fg sm:text-[4.25rem] lg:text-[5.25rem]">
              One budget your agents can&apos;t break.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-fg-dim">
              Give your whole fleet one budget. When a spend would take it below zero, the database
              refuses the write, whichever code path sent it. You can check that against production
              with one button.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <PrimaryLink href="/proof">Try to break it</PrimaryLink>
              <SecondaryLink href="/dashboard">Open the dashboard</SecondaryLink>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-fg-mute">
              The button sends six hostile statements to production as the app&apos;s own role. Each
              runs inside its own transaction and rolls back.
            </p>
          </div>

          <Journal />
        </div>
      </header>

      <SiteSection
        id="refusals"
        title="Every refusal has a code."
        intro="Aurora DSQL enforces each guarantee and answers with a standard Postgres SQLSTATE. Nothing in application code can switch one off."
        cites={[repoFile("db/schema.sql"), repoFile("db/app-role.sql"), repoFile("core/ledger.ts")]}
      >
        <ol className="border-b border-line">
          {REFUSALS.map((refusal) => (
            <li
              key={refusal.code}
              className="grid gap-x-10 gap-y-3 border-t border-line py-8 md:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <div>
                <div className="font-display text-[3.25rem] font-medium leading-none tracking-[-0.02em] text-brand [font-variant-numeric:lining-nums_tabular-nums]">
                  {refusal.code}
                </div>
                <div className="mt-2 font-mono text-xs text-fg-mute">{refusal.condition}</div>
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-fg">
                  {refusal.refuses}
                </h3>
                <p className="mt-3 max-w-2xl leading-relaxed text-fg-dim">{refusal.body}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                  <code className="break-all font-mono text-[13px] text-fg-mute">
                    {refusal.statement}
                  </code>
                  <Stamp code={refusal.code} className="text-sm" />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </SiteSection>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <h2 className="font-display text-[2rem] font-medium leading-[1.1] tracking-[-0.02em] text-fg sm:text-[2.6rem]">
              Try to break it yourself.
            </h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-fg-dim">
              Press one button and production&apos;s database receives these six statements, sent as{" "}
              <Mono>stub_app</Mono>, the same role the app runs as. You get back the SQLSTATE for
              each, straight from Aurora DSQL. Every statement rolls back.
            </p>
            <div className="mt-8">
              <PrimaryLink href="/proof">Try to break it</PrimaryLink>
            </div>
          </div>
          <ol className="divide-y divide-line self-start rounded-md border border-line-bright bg-ink">
            {PROOF_PROBES.map((probe, i) => (
              <li
                key={probe.id}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 sm:px-5"
              >
                <span className="tabular text-xs text-fg-mute">{i + 1}</span>
                <span className="text-[15px] text-fg">{probe.description}</span>
                <span className="tabular text-sm text-deny">{probe.expected}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <SiteSection
        title="A budget alert is not a budget."
        cites={[{ label: "The Register, Dec 2020", href: INCIDENT_URL }]}
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
          <a
            href={INCIDENT_URL}
            target="_blank"
            rel="noreferrer"
            className="group block self-start border-y border-line py-6"
          >
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-3 text-[15px]">
              <dt className="text-fg-dim">Budget set</dt>
              <dd className="tabular text-right text-fg">$7</dd>
              <dt className="text-fg-dim">Billed overnight</dt>
              <dd className="text-right font-display text-4xl font-medium tracking-[-0.02em] text-deny [font-variant-numeric:lining-nums] sm:text-5xl">
                ~$72,000
              </dd>
            </dl>
            <p className="mt-5 text-sm leading-relaxed text-fg-mute transition-colors group-hover:text-fg-dim">
              The cap was an alert, not an enforced limit. A runaway job recursed across hundreds of
              parallel workers before anyone woke up.
            </p>
          </a>
          <dl className="space-y-7">
            <Problem head="Per-session limits, no fleet budget">
              Agent wallets cap each session. Every session stays in bounds while the fleet total
              runs over.
            </Problem>
            <Problem head="Retries can double-pay">
              A failed transaction that retries can resend a payment that already went out. The log
              shows one charge and the vendor got two.
            </Problem>
            <Problem head="No system of record">
              When finance asks what the agents spent and on what, application logs are not an
              answer. There is nothing to reconcile against.
            </Problem>
          </dl>
        </div>
      </SiteSection>

      <SiteSection
        title="How a spend moves."
        intro="The money moves only after the ledger commits. If the database refuses, nothing is paid and the refusal is written down."
        cites={[repoFile("sdk/index.ts"), repoFile("core/ledger.ts"), repoFile("core/policy.ts")]}
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
          <ol className="space-y-7">
            <NumberedStep n={1} head="The agent asks first">
              Three lines of SDK put <Mono>guard()</Mono> in front of any paid call.
            </NumberedStep>
            <NumberedStep n={2} head="Policy runs inside the transaction">
              Caps up the hierarchy, vendor rules, approval thresholds and the velocity breaker are
              all checked in the same ACID transaction as the write.
            </NumberedStep>
            <NumberedStep n={3} head="Double entry, one commit">
              The agent&apos;s budget is debited, the vendor is credited, and every ancestor balance
              rolls up. OCC settles a race, and the CHECK constraints refuse any balance below zero
              or above its cap.
            </NumberedStep>
            <NumberedStep n={4} head="Pay, or record the refusal">
              On commit the agent pays. On refusal it gets a denial, and the ledger keeps a denial
              entry with the reason.
            </NumberedStep>
          </ol>
          <CodeBlock caption="npm install trystub. No dependencies, ESM and CommonJS.">{`import { StubClient } from "trystub";

const stub = new StubClient({
  apiKey: process.env.STUB_API_KEY,
});

const allowed = await stub.guard({
  vendorAccountId,
  amountUsd: 0.02,
  intent: "fetch market data",
});

if (allowed) await doThePaidThing();`}</CodeBlock>
        </div>
      </SiteSection>

      <SiteSection
        title="Swap the database and the guarantee breaks."
        intro={
          <>
            One budget across two Regions needs both Regions to write the same balance and agree on
            the result. That is active-active, strongly consistent replication, and on AWS only
            Aurora DSQL offers it.
          </>
        }
        cites={[repoFile("db/client.ts"), repoFile("db/failover.ts")]}
      >
        <div className="border-y border-line-bright">
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] gap-6 border-b border-line py-3 text-sm text-fg-mute sm:grid">
            <span>Database</span>
            <span>Writers</span>
            <span>Two Regions spend the last dollar</span>
          </div>
          <ul className="divide-y divide-line">
            {DATABASES.map((row) => (
              <li
                key={row.name}
                className="grid gap-1 py-4 text-[15px] sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] sm:gap-6"
              >
                <span className={row.ours ? "font-medium text-fg" : "text-fg"}>{row.name}</span>
                <span className="text-fg-dim">
                  <span className="sm:hidden">Writes in </span>
                  {row.writers}
                </span>
                <span className={row.tone}>{row.outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      </SiteSection>

      <SiteSection
        title="What's in the ledger."
        cites={[repoFile("core/settlement.ts"), repoFile("sdk/llm.ts"), repoFile("core/audit.ts")]}
      >
        <div className="grid gap-10 md:grid-cols-3 md:gap-8">
          {CAPABILITIES.map((column) => (
            <div key={column.group}>
              <h3 className="border-b border-line-bright pb-3 text-sm text-fg-mute">
                {column.group}
              </h3>
              <dl className="divide-y divide-line">
                {column.items.map((item) => (
                  <div key={item.head} className="py-4">
                    <dt className="font-medium text-fg">{item.head}</dt>
                    <dd className="mt-1 text-[15px] leading-relaxed text-fg-dim">{item.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </SiteSection>

      <SiteSection
        id="security"
        title="Security, reviewed."
        intro={
          <>
            An AWS Well-Architected review of Stub found the overspend check lived only in
            application code, and the app connected to the database as admin. Both are fixed and
            measured against the live clusters. Every number below is copied from{" "}
            <TextLink href={RESULTS_URL}>RESULTS.md</TextLink>.
          </>
        }
        cites={[RESULTS, { label: "/proof", href: "/proof" }, repoFile("infra/stub-clusters.yaml")]}
      >
        <div className="border-y border-line-bright">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-6 border-b border-line py-3 text-sm text-fg-mute sm:grid">
            <span>Measure</span>
            <span>Before</span>
            <span>After</span>
          </div>
          <ul className="divide-y divide-line">
            {REVIEW.map((row) => (
              <li
                key={row.measure}
                className="grid gap-1.5 py-3.5 text-[15px] sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-6"
              >
                <span className="text-fg">{row.measure}</span>
                <span className="text-sm text-fg-mute line-through decoration-deny/70 [font-variant-numeric:tabular-nums] sm:text-[15px]">
                  {row.before}
                </span>
                <span className="text-sm text-commit [font-variant-numeric:tabular-nums] sm:text-[15px]">
                  {row.after}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-6 max-w-2xl leading-relaxed text-fg-dim">
          The clusters, backups, trail, detectors and alarms are all CloudFormation in{" "}
          <Mono>infra/</Mono>, with termination protection on every stack, and deploy from{" "}
          <Mono>main</Mono>. The database checks you can run yourself on{" "}
          <TextLink href="/proof">/proof</TextLink>.
        </p>
      </SiteSection>

      <SiteSection
        title="Run it without an AWS account."
        intro={
          <>
            Stub runs on local Postgres too. Transactions run at <Mono>SERIALIZABLE</Mono>, so you
            get the same 40001 conflicts and the same 23514 refusals as production. Ten agents race
            one $3 budget: three commit, seven are denied, the balance stops at $0.00. CI runs that
            race on Postgres 17 for every push to <Mono>main</Mono> and every pull request, and
            sends the six statements from <TextLink href="/proof">/proof</TextLink> as{" "}
            <Mono>stub_app</Mono>.
          </>
        }
        cites={[repoFile("docker-compose.yml"), repoFile("test/local/overspend.test.ts")]}
      >
        <CodeBlock>{`npm run db:up
echo 'DATABASE_URL=postgres://stub:stub@localhost:5432/stub' >> .env
npm run migrate && npm run seed
npm run dev

npm run test:local`}</CodeBlock>
      </SiteSection>

      <SiteSection id="faq" title="What people ask first.">
        <div className="border-b border-line">
          {FAQS.map((faq, i) => (
            <details key={faq.question} open={i === 0} className="group border-t border-line">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 font-display text-xl font-medium leading-snug text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
                {faq.question}
                <span
                  aria-hidden
                  className="tabular mt-1 shrink-0 text-base text-brand transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="max-w-3xl pb-6 leading-relaxed text-fg-dim">{faq.answer}</p>
            </details>
          ))}
        </div>
      </SiteSection>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-display text-[2rem] font-medium leading-[1.1] tracking-[-0.02em] text-fg sm:text-[2.6rem]">
              Press the button. Production answers.
            </h2>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-fg-dim">
              Or open the dashboard and run a spend against the live ledger yourself.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <PrimaryLink href="/proof">Try to break it</PrimaryLink>
            <SecondaryLink href="/dashboard">Open the dashboard</SecondaryLink>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

interface JournalLine {
  memo: string;
  meta: string;
  amount?: string;
  balance?: string;
  code?: string;
  sql?: boolean;
}

const JOURNAL: JournalLine[] = [
  { memo: "Spend, primary Region healthy", meta: "us-east-1", amount: "−0.01", balance: "9.99" },
  { memo: "Spend, primary unreachable", meta: "us-east-2", amount: "−0.01", balance: "9.98" },
  { memo: "Spend, still on the peer", meta: "us-east-2", amount: "−0.01", balance: "9.97" },
  { memo: "Second writer, same dollars", meta: "rolled back, retried", code: "40001" },
  {
    memo: "UPDATE accounts SET balance_micro = -1",
    meta: "as admin",
    code: "23514",
    sql: true,
  },
  { memo: "DELETE FROM entries", meta: "as stub_app", code: "42501", sql: true },
];

function Journal() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-md border border-line-bright bg-surface shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
        <div className="flex items-baseline justify-between border-b border-line-bright px-4 py-3 sm:px-5">
          <span className="font-display text-lg text-fg">Journal</span>
          <span className="text-xs text-fg-mute">10.00 USD budget</span>
        </div>
        <ol>
          {JOURNAL.map((line, i) => (
            <li
              key={line.memo}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line px-4 py-3 last:border-b-0 sm:px-5"
            >
              <div className="min-w-0">
                <div
                  className={
                    line.sql
                      ? "truncate font-mono text-[13px] text-fg-dim"
                      : "truncate text-[15px] text-fg"
                  }
                >
                  {line.memo}
                </div>
                <div className="mt-0.5 text-xs text-fg-mute">{line.meta}</div>
              </div>
              {line.code ? (
                <Stamp code={line.code} delay={0.5 + (i - 3) * 0.35} className="text-xs" />
              ) : (
                <div className="tabular text-right">
                  <div className="text-[15px] text-fg">{line.amount}</div>
                  <div className="text-xs text-fg-mute">{line.balance}</div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-3 text-[13px] leading-relaxed text-fg-mute">
        The three spends are the failover drill in RESULTS.md: none lost, none doubled. Below them,
        what the database answers to writes it will not take.
      </figcaption>
    </figure>
  );
}

function Problem({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-display text-xl font-medium text-fg">{head}</dt>
      <dd className="mt-1.5 leading-relaxed text-fg-dim">{children}</dd>
    </div>
  );
}
