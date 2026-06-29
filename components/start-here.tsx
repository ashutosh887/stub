import Link from "next/link";

export function StartHere() {
  return (
    <section className="rounded-2xl border border-brand-dim bg-brand/[0.06] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-fg">
            New here? Try it in 60 seconds.
          </h2>
          <p className="mt-1 text-sm text-fg-dim">
            Live sample data on a real Aurora DSQL cluster, and nothing spends real money.
          </p>
        </div>
        <Link href="/how-it-works" className="text-sm text-brand hover:underline">
          How it works →
        </Link>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        <Step
          n="1"
          head="Run a spend"
          body="Authorize a small amount below and it commits to the ledger instantly."
        />
        <Step
          n="2"
          head="Trip a limit"
          body="Spend more than an agent has left. It's denied, and the balance holds."
        />
        <Step
          n="3"
          head="Ask the ledger"
          body="Ask a question in plain English and get an answer from the entries."
        />
      </ol>
    </section>
  );
}

function Step({ n, head, body }: { n: string; head: string; body: string }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="tabular flex h-5 w-5 items-center justify-center rounded-full border border-brand-dim text-[11px] text-brand">
          {n}
        </span>
        <span className="text-sm font-medium text-fg">{head}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-fg-dim">{body}</p>
    </li>
  );
}
