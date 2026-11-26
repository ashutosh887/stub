import { ProofRunner } from "@/components/proof-runner";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { GITHUB_URL } from "@/config/seo";

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
    after: "2, both convalidated = true",
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

      <main className="mx-auto max-w-4xl px-6 py-16">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Proof</div>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-fg">
          The database, not the code, refuses the overspend.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-fg-dim">
          The budget check used to live only in application code, and the app connected as the
          database owner. Now the balance column carries a CHECK constraint, and the app&apos;s role
          cannot rewrite the ledger or change the schema. Don&apos;t take that on trust: send the
          statements yourself.
        </p>

        <div className="mt-10">
          <ProofRunner />
        </div>

        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold text-fg">Before and after</h2>
          <p className="mt-2 text-sm text-fg-dim">
            Measured on 26 Nov 2026 against the live clusters. Every number is copied from{" "}
            <a
              href={`${BLOB}/${RESULTS}`}
              target="_blank"
              rel="noreferrer"
              className="text-fg underline decoration-line-bright underline-offset-2 hover:decoration-fg"
            >
              RESULTS.md
            </a>
            ; each row links the files that enforce it.
          </p>
          <div className="mt-5 overflow-hidden rounded-2xl border border-line">
            <div className="hidden grid-cols-[2fr_1.2fr_1.6fr_1.3fr] gap-4 bg-surface px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-fg-mute sm:grid">
              <div>Measure</div>
              <div>Before</div>
              <div>After</div>
              <div>Proof</div>
            </div>
            <ul className="divide-y divide-line">
              {ROWS.map((row) => (
                <li
                  key={row.measure}
                  className="grid gap-2 px-4 py-4 text-sm sm:grid-cols-[2fr_1.2fr_1.6fr_1.3fr] sm:gap-4 sm:py-3"
                >
                  <div className="font-medium text-fg sm:font-normal">{row.measure}</div>
                  <Cell label="Before" value={row.before} tone="text-deny" />
                  <Cell label="After" value={row.after} tone="text-commit" />
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 sm:block sm:space-y-1">
                    {row.sources.map((source) => (
                      <li key={source.path} className="min-w-0">
                        <a
                          href={`${BLOB}/${source.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="tabular break-all text-xs text-fg-dim hover:text-fg"
                        >
                          {source.label} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-sm text-fg-mute">
            Still allowed, by design: the app&apos;s role can raise a balance, because every spend,
            settle and release writes that column. The CHECK bounds it from below only.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold text-fg">Reproduce it yourself</h2>
          <p className="mt-2 text-sm text-fg-dim">
            The guardrail tests run offline, with no database. Against Aurora DSQL, map an IAM role
            to the app&apos;s database role and run the same probes this button sends; each prints
            the SQLSTATE the database returned.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-ink p-5 text-sm leading-relaxed text-fg-dim">
            <code>{`npm test
npm run migrate && npm run db:app-role
npm run db:app-role -- grant <iam-role-arn>
DSQL_USER=stub_app npx tsx scripts/wa-probe.ts`}</code>
          </pre>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <span className="mr-2 text-[11px] uppercase tracking-[0.14em] text-fg-mute sm:hidden">
        {label}
      </span>
      <span className={`tabular break-words ${tone}`}>{value}</span>
    </div>
  );
}
