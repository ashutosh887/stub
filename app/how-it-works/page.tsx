import Link from "next/link";
import { SiteNav } from "@/components/site-nav";

export const dynamic = "force-static";

export const metadata = {
  title: "How Stub works",
  description: "What Stub is, the double-entry ledger behind it, and how to try it in 60 seconds.",
};

export default function HowItWorks() {
  return (
    <>
      <SiteNav current="how" />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          How it works
        </div>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-fg">
          A budget the database refuses to break.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-fg-dim">
          Stub sits between your AI agents and the money they spend. Every spend is recorded as a
          double-entry transaction, and one that would exceed your budget never commits. Here&apos;s
          the whole idea, top to bottom.
        </p>

        <Concept
          n="01"
          title="One budget, the whole fleet"
          body="You set a single company-wide budget and split it into teams and agents. A spend is bound by the tightest cap along that chain — agent, then team, then org — and all of it is checked inside one database transaction before any money moves."
        />
        <Concept
          n="02"
          title="Every spend is double-entry"
          body="A spend debits the agent's budget and credits the vendor in the same atomic transaction. The entries table is append-only and hash-chained, so it doubles as a tamper-evident audit log. Balances are derived from it, never edited by hand."
        />
        <Concept
          n="03"
          title="A breach fails the transaction"
          body="When two agents race the same dollars across regions, Amazon Aurora DSQL's optimistic concurrency control lets one commit and returns a serialization error (SQLSTATE 40001) to the other. Stub retries against the fresh balance or records a denial. The balance never goes negative — there's no window where an overspend is briefly real."
        />
        <Concept
          n="04"
          title="Policies and safety run on every spend"
          body="Per-transaction caps, rolling-window limits, vendor allow/blocklists, and approval thresholds are evaluated in the same transaction. A velocity breaker auto-freezes a runaway agent, and a kill switch freezes one agent or the whole fleet instantly."
        />
        <Concept
          n="05"
          title="Ask the ledger in plain English"
          body="“How much did Marketing's agents spend on data APIs?” The model fills a constrained, parameterized query over the ledger and answers — it never writes raw SQL against your data."
        />

        {/* Try it */}
        <section className="mt-14 rounded-2xl border border-line bg-surface p-7">
          <h2 className="font-display text-2xl font-semibold text-fg">Try it in 60 seconds</h2>
          <p className="mt-2 text-sm text-fg-dim">
            The dashboard runs on a live Aurora DSQL cluster with sample data. Nothing you do spends
            real money.
          </p>
          <ol className="mt-5 space-y-4">
            <TryStep n="1" head="Run a spend" body="In “Simulate a spend,” authorize a small amount — it commits and appears in the ledger instantly." />
            <TryStep n="2" head="Trip a limit" body="Authorize more than an agent's remaining budget. It's denied and recorded, and the balance holds." />
            <TryStep n="3" head="Ask the ledger" body="Type a question in “Ask your ledger” and get an answer drawn straight from the entries." />
          </ol>
          <Link
            href="/dashboard"
            className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Open the dashboard
          </Link>
        </section>

        {/* SDK */}
        <section className="mt-10">
          <h2 className="font-display text-2xl font-semibold text-fg">Drop it into an agent</h2>
          <p className="mt-2 text-sm text-fg-dim">
            Put the budget gate in front of any paid call. The money moves only after the spend commits.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-ink p-5 text-sm leading-relaxed text-fg-dim">
            <code>{`import { StubClient } from "stub";

const stub = new StubClient({ apiKey: process.env.STUB_API_KEY });

if (await stub.guard({ vendorAccountId, amountUsd: 0.02, intent: "fetch market data" })) {
  await doThePaidThing(); // runs only if the budget gate committed the spend
}`}</code>
          </pre>
        </section>

        <div className="mt-12 border-t border-line pt-6 text-sm text-fg-mute">
          Built on Amazon Aurora DSQL, Next.js, and Vercel.{" "}
          <a
            href="https://github.com/ashutosh887/stub"
            target="_blank"
            rel="noreferrer"
            className="text-fg-dim hover:text-fg"
          >
            View the source ↗
          </a>
        </div>
      </main>
    </>
  );
}

function Concept({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <section className="mt-12 grid gap-4 border-t border-line pt-8 sm:grid-cols-[auto_1fr] sm:gap-6">
      <div className="tabular text-sm text-brand">{n}</div>
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">{title}</h2>
        <p className="mt-2 leading-relaxed text-fg-dim">{body}</p>
      </div>
    </section>
  );
}

function TryStep({ n, head, body }: { n: string; head: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-dim text-sm text-brand">
        {n}
      </span>
      <div>
        <div className="text-sm font-medium text-fg">{head}</div>
        <div className="mt-0.5 text-sm text-fg-dim">{body}</div>
      </div>
    </li>
  );
}
