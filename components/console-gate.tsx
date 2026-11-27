import { AdminLogin } from "@/components/admin-login";
import { SiteFooter } from "@/components/site-footer";
import { CodeBlock, PrimaryLink, TextLink } from "@/components/site-kit";
import { SiteNav } from "@/components/site-nav";
import { GITHUB_URL } from "@/config/seo";

const LOCAL_RUN = `git clone ${GITHUB_URL} && cd stub
npm install && npm run db:up
echo 'DATABASE_URL=postgres://stub:stub@localhost:5432/stub' >> .env
npm run migrate && npm run seed && npm run seed:activity
npm run dev`;

export function ConsoleGate() {
  return (
    <>
      <SiteNav current="dashboard" />
      <main className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-20 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <div className="min-w-0">
          <h1 className="max-w-2xl font-display text-[2.4rem] font-medium leading-[1.06] tracking-[-0.03em] text-fg sm:text-5xl">
            This console belongs to the operator.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fg-dim">
            It shows a live ledger&apos;s balances, entries and policies, and it can freeze agents
            and change budgets. So in production every console page and admin route opens only with
            the operator&apos;s token. Without one, there are two ways in.
          </p>

          <section aria-labelledby="gate-proof" className="mt-12 border-t border-line pt-8">
            <h2
              id="gate-proof"
              className="font-display text-[1.6rem] font-medium leading-tight tracking-[-0.02em] text-fg"
            >
              Test the guarantee on production
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-fg-dim">
              Six statements try to overspend a budget or rewrite the ledger, sent as the app&apos;s
              own database role. Aurora DSQL answers each one, and nothing persists.
            </p>
            <div className="mt-6">
              <PrimaryLink href="/proof">Try to break it</PrimaryLink>
            </div>
          </section>

          <section aria-labelledby="gate-local" className="mt-12 border-t border-line pt-8">
            <h2
              id="gate-local"
              className="font-display text-[1.6rem] font-medium leading-tight tracking-[-0.02em] text-fg"
            >
              Run the whole console yourself
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-fg-dim">
              On local Postgres the console opens without a token, with sample agents and the same
              CHECK constraints as production. You need Docker and Node, not an AWS account.
            </p>
            <div className="mt-6 max-w-2xl">
              <CodeBlock caption="Then open http://localhost:3000/dashboard.">
                {LOCAL_RUN}
              </CodeBlock>
            </div>
            <p className="mt-4 text-[15px] text-fg-dim">
              <TextLink href={`${GITHUB_URL}#quickstart`}>The quickstart in the README</TextLink>{" "}
              covers the Aurora DSQL path too.
            </p>
          </section>
        </div>

        <aside className="lg:pt-3">
          <div className="rounded-md border border-line-bright bg-surface p-5 sm:p-6 lg:sticky lg:top-24">
            <AdminLogin />
          </div>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
