import Link from "next/link";
import { SiteNav } from "@/components/site-nav";

export const dynamic = "force-static";

const GITHUB_URL = "https://github.com/ashutosh887/stub";

export default function Home() {
  return (
    <>
      <SiteNav current="home" />

      {/* Hero */}
      <header className="relative overflow-hidden border-b border-line hero-veil">
        <div className="pointer-events-none absolute inset-0 grid-veil opacity-60" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
          <div>
            <span className="rise inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-fg-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Amazon Aurora DSQL · double-entry
            </span>

            <h1 className="rise rise-2 mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-fg sm:text-6xl">
              One budget your
              <br />
              agents can&apos;t break.
            </h1>

            <p className="rise rise-3 mt-6 max-w-xl text-lg leading-relaxed text-fg-dim">
              Stub is the general ledger for agent spend. Set one company-wide budget across your
              whole fleet — and a spend that would breach it{" "}
              <span className="text-fg">fails the database transaction</span>, not your nerves.
            </p>

            <div className="rise rise-4 mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                Open the live dashboard
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line-bright px-5 py-2.5 text-sm font-medium text-fg-dim transition-colors hover:text-fg"
              >
                View the source
              </a>
            </div>

            <dl className="rise rise-4 mt-10 flex gap-8 border-t border-line pt-6">
              <Metric value="$0" label="overspend window" />
              <Metric value="2" label="AWS regions, one budget" />
              <Metric value="40001" label="the error that blocks overspend" />
            </dl>
          </div>

          {/* Signature: a live double-entry record + a rejected overspend */}
          <LedgerSignature />
        </div>
      </header>

      {/* The problem */}
      <Section eyebrow="The problem" title="Agents can spend now. Nothing governs the whole fleet.">
        <div className="grid gap-6 md:grid-cols-3">
          <Card
            head="Per-session limits, no fleet budget"
            body="Agent wallets cap each session. Across a fleet, no single budget holds — every session stays in bounds while the total quietly runs over."
          />
          <Card
            head="Retries can double-pay"
            body="A failed transaction that retries can re-send an already-irreversible payment. The ledger shows one charge; the vendor was paid twice."
          />
          <Card
            head="No system of record"
            body="When finance asks how much agents spent, and on what, application logs aren't an answer. There's nothing to reconcile or audit against."
          />
        </div>
      </Section>

      {/* How it holds */}
      <Section
        eyebrow="How the budget holds"
        title="The database is the guardrail — not application luck."
        muted
      >
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          <Step
            n="01"
            head="Every spend is checked in one transaction"
            body="Policies, the budget hierarchy (org → team → agent), and velocity limits are evaluated inside a single ACID transaction — before any money moves."
          />
          <Step
            n="02"
            head="A breach loses its commit"
            body="Under concurrent cross-region writes, Aurora DSQL's optimistic concurrency control returns a serialization failure — SQLSTATE 40001. The overspend never commits."
          />
          <Step
            n="03"
            head="The denial is recorded, the balance holds"
            body="Stub retries against the fresh balance or records a denial. The balance never goes negative. Every line is immutable and hash-chained for audit."
          />
        </ol>
      </Section>

      {/* Why DSQL */}
      <Section eyebrow="Why Amazon Aurora DSQL" title="Swap the database and the guarantee breaks.">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <p className="text-lg leading-relaxed text-fg-dim">
            Correctness here <span className="text-fg">is</span> the database&apos;s consistency
            model. The load-bearing property is <span className="text-fg">active-active,
            multi-region strong consistency</span> — a writer in us-east-1 and a writer in us-east-2
            hitting the same balance resolve to one consistent outcome. No other AWS database offers
            it: Aurora PostgreSQL Global is single-writer, and DynamoDB global tables are eventually
            consistent — last-writer-wins, which means silent overspend during replication.
          </p>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">
              The unswappable core
            </div>
            <ul className="mt-4 space-y-3 text-sm text-fg-dim">
              <Bullet>Strong consistency + OCC across regions</Bullet>
              <Bullet>Double-entry ledger as first-class SQL</Bullet>
              <Bullet>Hash-chained, tamper-evident audit trail</Bullet>
              <Bullet>JSON receipts beside relational rows</Bullet>
            </ul>
          </div>
        </div>
      </Section>

      {/* What it does */}
      <Section eyebrow="What you get" title="A treasury console for the agent economy." muted>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          <Feature head="Hierarchical budgets" body="Org → team → agent caps, enforced together in one transaction." />
          <Feature head="Exactly-once settlement" body="Reserve, pay once, settle the real cost. A retry around an irreversible payment can't double-charge." />
          <Feature head="Policy engine" body="Per-transaction and rolling-window caps, vendor rules, approval thresholds." />
          <Feature head="Cost attribution" body="Tag every spend to a team, customer, or feature and answer chargeback questions cloud bills can't." />
          <Feature head="Tamper-evident audit" body="Hash-chained entries that detect any altered row, exportable as accounting journal lines." />
          <Feature head="Velocity breaker" body="Runaway spend trips a limit and auto-freezes the account." />
          <Feature head="Kill switch" body="Freeze one agent or the entire fleet instantly." />
          <Feature head="Ask your ledger" body="Plain-English questions answered over the ledger — never raw SQL." />
          <Feature head="3-line SDK" body="Drop the budget gate in front of any paid call. Money moves only after it commits." />
        </div>
      </Section>

      {/* CTA */}
      <section className="border-y border-line hero-veil">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-fg">
              See the cap hold, live.
            </h2>
            <p className="mt-2 text-fg-dim">
              Replay a runaway agent and watch the overspend get refused, transaction by transaction.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Link
              href="/incident"
              className="rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              Replay an incident
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-line-bright px-6 py-3 text-sm font-medium text-fg-dim transition-colors hover:text-fg"
            >
              Open the dashboard
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-fg-mute sm:flex-row">
        <span className="font-display text-base text-fg-dim">Stub</span>
        <span>One budget your agents can&apos;t break. Built on Amazon Aurora DSQL.</span>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-fg">
          GitHub ↗
        </a>
      </footer>
    </>
  );
}

/* ── Signature: double-entry record + rejected overspend ── */
function LedgerSignature() {
  return (
    <div className="rise rise-3 relative">
      <div className="rounded-2xl border border-line-bright bg-surface p-5 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <span className="text-[11px] uppercase tracking-[0.18em] text-fg-mute">Ledger</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-commit">
            <span className="h-1.5 w-1.5 rounded-full bg-commit" />
            committed
          </span>
        </div>

        {/* one spend, two entries, split by the double-entry rule */}
        <div className="relative mt-4 grid grid-cols-2 gap-4">
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 ledger-rule" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">Debit · budget</div>
            <div className="mt-1 text-sm text-fg">research-agent</div>
            <div className="tabular mt-2 text-xl text-deny">−$0.04</div>
          </div>
          <div className="pl-4 text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-fg-mute">Credit · vendor</div>
            <div className="mt-1 text-sm text-fg">Data API (x402)</div>
            <div className="tabular mt-2 text-xl text-commit">+$0.04</div>
          </div>
        </div>

        <div className="tabular mt-4 truncate border-t border-line pt-3 text-[11px] text-fg-mute">
          hash 9f2a…c41b · prev 6b18…ee03 · intent &quot;fetch market data&quot;
        </div>
      </div>

      {/* the rejected overspend, stamped */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-deny-dim bg-surface px-5 py-3">
        <div>
          <div className="text-sm text-fg">coding-agent → LLM tokens</div>
          <div className="text-[11px] text-deny">cap exceeded · serialization failure</div>
        </div>
        <span className="tabular rounded-md border border-deny-dim px-2 py-1 text-xs text-deny">
          40001 · rejected
        </span>
      </div>
    </div>
  );
}

/* ── primitives ── */
function Section({
  eyebrow,
  title,
  muted,
  children,
}: {
  eyebrow: string;
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={muted ? "bg-surface/40" : ""}>
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">{eyebrow}</div>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
          {title}
        </h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="tabular text-2xl font-semibold text-fg">{value}</div>
      <div className="mt-0.5 text-xs text-fg-mute">{label}</div>
    </div>
  );
}

function Card({ head, body }: { head: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <h3 className="text-base font-semibold text-fg">{head}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fg-dim">{body}</p>
    </div>
  );
}

function Step({ n, head, body }: { n: string; head: string; body: string }) {
  return (
    <li className="bg-surface p-6">
      <div className="tabular text-sm text-brand">{n}</div>
      <h3 className="mt-3 text-base font-semibold text-fg">{head}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fg-dim">{body}</p>
    </li>
  );
}

function Feature({ head, body }: { head: string; body: string }) {
  return (
    <div className="bg-surface p-6">
      <h3 className="text-sm font-semibold text-fg">{head}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{body}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
      <span>{children}</span>
    </li>
  );
}
