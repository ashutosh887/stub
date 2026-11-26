import { ProofRunner } from "@/components/proof-runner";
import { RaceChart } from "@/components/race-chart";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { CodeBlock, TextLink } from "@/components/site-kit";
import { GITHUB_URL } from "@/config/seo";
import { RACE, RACE_FILES, dollars, driverName, inWords, raceSentences } from "@/lib/race";

export const dynamic = "force-static";

export const metadata = {
  title: "Proof: the database refuses the overspend",
  description:
    "Send the statements that would overspend a budget or rewrite the ledger, as the app's own database role, and read the SQLSTATE Aurora DSQL returns.",
  alternates: { canonical: "/proof" },
};

const BLOB = `${GITHUB_URL}/blob/main`;
const RESULTS = "measurements/wa-review/RESULTS.md";

interface Source {
  label: string;
  path: string;
}

interface Row {
  measure: string;
  before: string;
  after: string;
  sources: Source[];
}

const results = (anchor: string): Source => ({ label: "RESULTS.md", path: `${RESULTS}#${anchor}` });
const file = (path: string): Source => ({ label: path, path });

const ROWS: Row[] = [
  {
    measure: "Ten writers skip the app's check and race a $3 budget",
    before: "10 committed, balance -$7.00",
    after: "3 committed, 7 refused 23514, balance $0.00",
    sources: [
      file("lib/bypass-race.ts"),
      file("test/local/db-guardrail.test.ts"),
      results("the-bypass-race-what-the-check-adds-26-nov-2026"),
    ],
  },
  {
    measure: "Raise a budget above its cap, as the app's DB role",
    before: "accepted",
    after: "refused, 23514 accounts_balance_within_cap",
    sources: [
      file("db/schema.sql"),
      results("a-second-database-invariant-no-balance-above-its-cap-26-nov-2026"),
    ],
  },
  {
    measure: "App's database role",
    before: "admin (owns every table)",
    after: "stub_app (no ownership, column-level UPDATE)",
    sources: [file("db/app-role.sql"), file("scripts/app-role.ts"), results("before-and-after")],
  },
  {
    measure: "Balance below zero, as the app's DB role",
    before: "accepted",
    after: "refused, 23514 accounts_balance_nonnegative",
    sources: [
      file("db/schema.sql"),
      file("scripts/migrate.ts"),
      results("3b-what-the-database-accepts-from-stub_app"),
    ],
  },
  {
    measure: "Balance below zero, as admin",
    before: "accepted",
    after: "refused, 23514",
    sources: [file("db/schema.sql"), results("3b-what-the-database-accepts-from-stub_app")],
  },
  {
    measure: "Rewrite an entries row, as the app's DB role",
    before: "accepted",
    after: "refused, 42501 permission denied for table entries",
    sources: [
      file("db/app-role.sql"),
      file("test/invariant/least-privilege.test.ts"),
      results("3b-what-the-database-accepts-from-stub_app"),
    ],
  },
  {
    measure: "Delete an entries row, as the app's DB role",
    before: "accepted",
    after: "refused, 42501",
    sources: [
      file("db/app-role.sql"),
      file("test/invariant/least-privilege.test.ts"),
      results("3b-what-the-database-accepts-from-stub_app"),
    ],
  },
  {
    measure: "Create an account, as the app's DB role",
    before: "accepted",
    after: "refused, 42501",
    sources: [file("db/app-role.sql"), results("3b-what-the-database-accepts-from-stub_app")],
  },
  {
    measure: "CREATE TABLE, as the app's DB role",
    before: "allowed (owner)",
    after: "refused, 42501 permission denied for schema public",
    sources: [file("db/app-role.sql"), results("3b-what-the-database-accepts-from-stub_app")],
  },
  {
    measure: "DROP TABLE entries, as the app's DB role",
    before: "allowed (owner)",
    after: "refused, 42501 must be owner of table entries",
    sources: [file("db/app-role.sql"), results("3b-what-the-database-accepts-from-stub_app")],
  },
  {
    measure: "CHECK constraints on balance tables",
    before: "0",
    after: "3, all convalidated = true",
    sources: [file("db/schema.sql"), file("scripts/migrate.ts"), results("before-and-after")],
  },
  {
    measure: "App's AWS principal: destructive DSQL actions allowed (3 actions × 2 clusters)",
    before: "6 of 6 (shared IAM user)",
    after: "0 of 6 (stub-app role)",
    sources: [
      file("infra/stub-app-role.yaml"),
      results("3a-iam-simulation-of-the-stub-app-role-092310-utc"),
    ],
  },
  {
    measure: "App's credentials",
    before: "long-lived access key",
    after: "Vercel OIDC, 1-hour sessions, trusted only for this project's production environment",
    sources: [file("infra/stub-app-role.yaml"), results("before-and-after")],
  },
  {
    measure: "Unlisted principal connects as admin",
    before: "2 of 2 clusters",
    after: "0 of 2 (access denied)",
    sources: [
      file("infra/stub-clusters.yaml"),
      results("f09-only-the-app-role-and-the-operators-may-connect-sec05-bp01-sec03-bp01"),
    ],
  },
  {
    measure: "Deletion protection",
    before: "0 of 2 clusters",
    after: "2 of 2",
    sources: [file("infra/stub-clusters.yaml"), results("before-and-after")],
  },
  {
    measure: "SEC03-BP01 guardrail test",
    before: "0 of 3 pass on main",
    after: "3 of 3 pass",
    sources: [file("test/invariant/least-privilege.test.ts"), results("3c-repository-checks")],
  },
  {
    measure: "Guardrail test over the templates",
    before: "none",
    after: "6 tests; giving the app role DbConnectAdmin in the template fails 1 of 6",
    sources: [
      file("test/invariant/infrastructure.test.ts"),
      results("f07-what-is-live-is-what-is-in-the-repo-sec01-bp05-rel08-bp01"),
    ],
  },
];

export default function Proof() {
  return (
    <>
      <SiteNav current="proof" />

      <main>
        <header className="mx-auto max-w-5xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
          <h1 className="max-w-3xl font-display text-[2.6rem] font-medium leading-[1.04] tracking-[-0.03em] text-fg sm:text-6xl">
            The database, not the code, refuses the overspend.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fg-dim">
            The budget check used to live only in application code, and the app connected as the
            database owner. Now two CHECK constraints keep every budget between zero and its cap,
            and the app&apos;s role cannot rewrite the ledger or change the schema. Send the
            statements yourself and read what the database answers.
          </p>
        </header>

        <RaceFigure />

        <div className="mx-auto mt-16 max-w-5xl px-4 sm:px-6">
          <ProofRunner />
        </div>

        <section className="mx-auto mt-20 max-w-5xl px-4 sm:px-6">
          <h2 className="font-display text-[2rem] font-medium leading-tight tracking-[-0.02em] text-fg">
            Before and after
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-fg-dim">
            Measured on 26 Nov 2026 against the live clusters. Every number is copied from{" "}
            <TextLink href={`${BLOB}/${RESULTS}`}>RESULTS.md</TextLink>, and each row links the
            files that enforce it. Struck-through values are the old state.
          </p>
          <div className="mt-8 border-y border-line-bright">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1.3fr)] gap-5 border-b border-line py-3 text-sm text-fg-mute md:grid">
              <div>Measure</div>
              <div>Before</div>
              <div>After</div>
              <div>Enforced in</div>
            </div>
            <ul className="divide-y divide-line">
              {ROWS.map((row) => (
                <li
                  key={row.measure}
                  className="grid gap-2 py-4 text-[15px] md:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1.3fr)] md:gap-5"
                >
                  <div className="font-medium text-fg md:font-normal">{row.measure}</div>
                  <Cell
                    label="Before"
                    value={row.before}
                    tone="text-fg-mute line-through decoration-deny/70"
                  />
                  <Cell label="After" value={row.after} tone="text-commit" />
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 md:block md:space-y-1">
                    {row.sources.map((source) => (
                      <li key={source.path} className="min-w-0">
                        <a
                          href={`${BLOB}/${source.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all font-mono text-xs text-fg-dim transition-colors hover:text-brand"
                        >
                          {source.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-fg-mute">
            The app&apos;s role must write balances, so a role alone cannot stop an overspend. The
            two CHECK constraints can: a budget stays between zero and its cap whoever sends the
            write. Sharded balances keep only the lower bound, because a cap covers the sum of the
            shards.
          </p>
        </section>

        <section className="mx-auto mt-20 mb-20 max-w-5xl px-4 sm:px-6">
          <h2 className="font-display text-[2rem] font-medium leading-tight tracking-[-0.02em] text-fg">
            Reproduce it yourself
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-fg-dim">
            The guardrail tests run offline, with no database. Against Aurora DSQL, map an IAM role
            to the app&apos;s database role and run the probe script, which prints the SQLSTATE for
            each statement it sends. On local Postgres, the local test suite sends the six
            statements above as stub_app, and CI runs it on every push to main and every pull
            request.
          </p>
          <div className="mt-6">
            <CodeBlock>{`npm test
npm run migrate && npm run db:app-role
npm run db:app-role -- grant <iam-role-arn>
DSQL_USER=stub_app npx tsx scripts/wa-probe.ts`}</CodeBlock>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

function RaceFigure() {
  const sentences = raceSentences();
  const writers = inWords(RACE.writers);
  return (
    <section aria-labelledby="race" className="mx-auto max-w-5xl px-4 sm:px-6">
      <figure className="rounded-md border border-line-bright bg-surface p-5 sm:p-7">
        <h2
          id="race"
          className="font-display text-[1.9rem] font-medium leading-tight tracking-[-0.02em] text-fg"
        >
          {writers[0].toUpperCase() + writers.slice(1)} writers, one {dollars(RACE.startUsd)} budget
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-fg-dim">
          Each writer spends {dollars(RACE.amountUsd)} with a raw UPDATE that skips the app&apos;s
          check, the way a script or a hotfix would. {sentences.before} {sentences.after}
        </p>
        <div className="mt-8">
          <RaceChart race={RACE} />
        </div>
        <figcaption className="mt-5 max-w-2xl text-[13px] leading-relaxed text-fg-mute">
          Measured on {driverName(RACE.driver)}, connected as {RACE.connectedAs.join(" and ")}
          {RACE.connectedAs.join() === "admin" ? ", the role the old app used" : ""},{" "}
          {RACE.before.runs} runs before and {RACE.after.runs} after. The only change between them
          is the schema. Each run&apos;s per-writer timeline is in{" "}
          <a
            href={`${BLOB}/${RACE_FILES.before}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-fg-dim transition-colors hover:text-brand"
          >
            dsql-race-before.json
          </a>{" "}
          and{" "}
          <a
            href={`${BLOB}/${RACE_FILES.after}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-fg-dim transition-colors hover:text-brand"
          >
            dsql-race-after.json
          </a>
          .
        </figcaption>
      </figure>
    </section>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <span className="mr-2 text-xs text-fg-mute md:hidden">{label}</span>
      <span
        className={`break-words text-sm [font-variant-numeric:tabular-nums] md:text-[15px] ${tone}`}
      >
        {value}
      </span>
    </div>
  );
}
