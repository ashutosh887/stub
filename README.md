# Stub

**The general ledger for agent spend.**

_One budget your agents can't break._

Stub keeps one budget for a whole fleet of AI agents, and the database refuses any transaction that
would break it.

**Live:** [trystub.vercel.app](https://trystub.vercel.app), on Amazon Aurora DSQL and Next.js on
Vercel.

---

## What is Stub?

Stub is a double-entry **spend ledger** for the AI agents an organization runs and the money they
spend: x402 micropayments, paid APIs and LLM tokens. It holds one company-wide budget that **cannot
be overspent** and keeps an append-only, queryable audit trail. Refusing an overspend is one
feature of the ledger. The ledger is the product.

## The problem

Agent payment frameworks such as Amazon Bedrock AgentCore Payments give agents wallets, but they
enforce spending limits **per session only**. Nothing governs the budget across agents and Regions,
and nothing keeps audit-grade books. Every session can stay inside its own limit while the fleet
overspends overnight, and afterwards nobody can answer the two questions finance asks: **how much
did our agents spend, and on what?**

A billing alert does not stop the spend. In the
[case The Register reported in December 2020](https://www.theregister.com/2020/12/10/google_cloud_over_run/),
a team set a $7 budget and was billed about $72,000 overnight, because the budget was an alert and
not an enforced limit. Stub refuses the spend before the transaction commits, and keeps books
finance can reconcile.

## How it works

A write that would take a balance below zero or above its cap **is refused by the database**, with
`SQLSTATE 23514`, whichever code path or role sends it. When writers in two Regions race for the
same balance, Aurora DSQL's optimistic concurrency control commits one and returns a serialization
failure (`SQLSTATE 40001`) to the other. Stub retries the loser against the fresh balance, and it
either commits or records a denial. OCC decides the order of the writes; the `CHECK` constraints
decide whether a write is affordable.

The contended row does the work a lock would. A spend debits its account and updates every ancestor
balance up the hierarchy in the same transaction, so agents racing the same budget all write one
shared row and the loser conflicts. That is how the invariant holds across Regions, where DSQL has
no row locks (`SELECT … FOR UPDATE`).

The two constraints are `accounts_balance_nonnegative` and `accounts_balance_within_cap`. A
script, a hotfix or a new route that skips the app's check gets `23514`, and so does `admin`. If a
`23514` reaches the app's own spend path, the app records it as a denial with reason `db_refused`.
The app connects as `stub_app`, a role that cannot rewrite or delete a ledger entry or change the
schema (`42501`). It gets one-hour IAM credentials from Vercel OIDC and stores no key.

### Exactly-once around an irreversible payment

A naive retry around OCC can pay twice. If the payment goes out _inside_ the retried transaction,
a serialization conflict re-runs the block and **pays again**. Stub splits the flow the way card
networks do: **reserve, pay, settle**. One transaction holds the estimate against the cap. The
irreversible payment fires once, outside the transaction, keyed on the reservation. A second
transaction settles the actual cost and refunds the difference. OCC retries replay the ledger and
never the payment. If a process crashes between pay and settle, an idempotent sweeper reclaims the
hold. Settle and sweep contend on the hold row, OCC picks one winner, and the other does nothing.

```
Agent (x402 / AgentCore)
  → 3-line SDK: guard(), or reserve → pay → settle
  → Stub API (Next.js route: auth, rate limit, request id)
      → policy, hierarchy and velocity checks
      → atomic double-entry write on Aurora DSQL
          40001 → retry, or deny and write a denial entry
          23514 → refused by the CHECK constraints, recorded as a db_refused denial
  → append-only, hash-chained ledger
      → dashboard, incident replay, audit, attribution, NL query
```

## How we know it holds

- **[trystub.vercel.app/proof](https://trystub.vercel.app/proof)**: press _Try to break it_ and
  production sends six statements that would overspend a budget or rewrite the ledger, as the app's
  own role, each inside `BEGIN … ROLLBACK`. The database refuses all six: `23514` twice and
  `42501` four times. The page counts every visitor run and charts the same raw-writer race on
  Aurora DSQL before and after the CHECK, straight from
  [dsql-race-before.json](./measurements/wa-review/dsql-race-before.json) and
  [dsql-race-after.json](./measurements/wa-review/dsql-race-after.json). The before and after
  numbers are in [measurements/wa-review/RESULTS.md](./measurements/wa-review/RESULTS.md).
- **`npm run test:local`** runs on a real Postgres. Ten agents race a $3 budget through the app's spend path:
  three commit, seven are denied, and the balance ends at $0.00. A second test sends the six
  `/proof` statements as `stub_app`, and has ten writers skip the app's check and send raw
  `UPDATE`s at a $3 budget: three commit and seven get `23514`. CI's `db-proof` job runs this on
  Postgres 17 for every push to `main` and every pull request.
- **[`db-guardrail`](./.github/actions/db-guardrail)** is that probe run as a reusable GitHub
  Action. Point it at your own Postgres or Aurora DSQL app role with a JSON file of statements and
  the SQLSTATE each must return. `db-proof` runs it on Stub's own six probes.
- **`npm run race:bypass`** runs that raw-writer race on its own. On the schema from before the
  CHECK, all ten committed and the budget ended at −$7.00, as the table owner and as `stub_app`
  alike. The role alone does not stop an overspend, because the app must be able to write balances.
  The same race on Aurora DSQL itself, on a temporary cluster with only the schema changed between
  runs, is in [RESULTS.md](./measurements/wa-review/RESULTS.md) with every run's per-writer timeline
  (`measurements/wa-review/dsql-race-*.json`).
- **`npm run harness`** races a naive retry against Stub with 16 concurrent writers and crashes
  injected after payment. The naive version sends $43.00 of payments against a $3.00 budget. Stub
  sends $3.00, leaves no stuck holds and never goes negative. The same assertions run in CI
  (`npm test`).
- **`npm run test:live`** runs the cross-Region race on the live cluster: six agents in two AWS
  Regions hit one near-empty budget, what fits commits, the rest are denied with real `40001`s, and
  the balance never goes negative.
- **The audit page** re-verifies the hash chain and shows tamper detection on a throwaway copy of a
  real entry. It never touches the live ledger.

### The known ceiling

The contended balance row makes the invariant work, and it also caps throughput. `npm run bench`
measures it. On local Postgres, throughput against a single budget stays flat at around 300 to 450
spends a second however many writers join, while conflicts per spend climb past 2 and p95 latency
goes from about 13 ms at 1 writer to about 380 ms at 32. More writers buy nothing.

`core/sharded.ts` splits one balance into N shard rows. Each shard is checked and debited on its
own, so writers collide less. No shard can go below zero, and `CHECK (balance_micro >= 0)` on
`account_shards` enforces that in the database, so the sum cannot either. **Sharding raises
throughput without weakening the overspend invariant.** A spend takes one shard on the fast path
and reads the others only when that shard is short, so it borrows across shards instead of denying
a spend that fits. Measured at 8 shards on local Postgres, throughput rose 1.2 to 2.8 times with
equal or fewer conflicts per spend.

Sharding is opt-in per account. `provisionShards` sets an account's `sharded` flag, and
`/api/spend` sends any account with that flag down the sharded path (`core/sharded.ts`
`spendAuto`), with the same policy, frozen, velocity and hierarchy checks either way. The console
has no button for it yet. Call the admin-gated `POST /api/accounts/shard`, or
`stub.provisionShards(accountId)` from the SDK. These numbers come from local Postgres at
`SERIALIZABLE`, which also tracks read conflicts. DSQL checks conflicts on writes only, and the
sharded benchmark has not been run there yet.

## Why Aurora DSQL

Across Regions, enforcing the budget depends on the database's consistency model. The property
Stub needs is **active-active, multi-Region strong consistency**: a writer in `us-east-1` and a
writer in `us-east-2` hitting the same balance resolve to one outcome. No other AWS database offers
it. Aurora PostgreSQL Global has one writer Region, and DynamoDB global tables are eventually
consistent, so the last writer wins and the overspend goes unnoticed while replication catches up.
Swap the database and the cross-Region guarantee breaks.

## Architecture

| Layer    | Choice                                                                |
| -------- | --------------------------------------------------------------------- |
| Database | **Amazon Aurora DSQL**: strong consistency, OCC, CHECK constraints    |
| Driver   | `pg` over the Aurora DSQL Node connector (automatic IAM tokens)       |
| API      | Next.js App Router route handlers (Node runtime)                      |
| Frontend | Next.js + Tailwind                                                    |
| Deploy   | Vercel                                                                |
| NL query | OpenAI function-calling, with a deterministic offline parser fallback |
| SDK      | `trystub` on npm: dependency-free `fetch` client                      |

```mermaid
flowchart LR
  A[Agent fleet<br/>x402 / AgentCore] -->|trystub SDK| B[Stub API<br/>Next.js on Vercel]
  B --> C{policy, hierarchy<br/>velocity, idempotency}
  C -->|reserve / spend| D[(Amazon Aurora DSQL<br/>us-east-1 + us-east-2<br/>strong consistency, OCC)]
  D -->|40001| C
  C -->|pay once| P[Payment rail<br/>x402 testnet]
  C --> L[Immutable hash-chained ledger<br/>double-entry + receipts]
  L --> V[Console<br/>dashboard, incident, settlement<br/>audit, attribution, NL query]
```

The domain code has no database imports, so the database adapter can be swapped:

```
core/     pure, dependency-free domain: ledger, settlement, sharding, harness, policy, hash, query
db/       Postgres-family adapter: pool, Store implementation, schema.sql (DSQL or plain Postgres)
sdk/      the client published to npm as trystub, the x402 / AgentCore adapter, LLM metering
app/      Next.js console, public pages and API routes
config/   env and SEO values in one place
scripts/  migrate, seed, harness, bench, sweep, demo-agent, race:bypass, drill:failover
infra/    CloudFormation for the app role, clusters, backups, audit trail, detection, deploy role
test/     invariant suite (offline), local Postgres, live cross-Region
```

## Data model

A deliberate double-entry ledger:

- **`accounts`**: budget accounts (org → team → agent → vendor), each with a balance, a hard cap,
  and an optional velocity limit. A spend is bound by the **tightest cap up the hierarchy**. It
  debits the named account and updates every ancestor's balance in the same transaction. CHECK
  constraints keep each balance between zero and its cap.
- **`entries`**: double-entry lines, append-only, and the audit log. `stub_app` has no `UPDATE` or
  `DELETE` on this table. Each line carries a compressed JSON receipt of the payment context and is
  **hash-chained** (`prev_hash`, then `hash`), so an altered or removed row breaks the chain. Every
  line is attributed to a user, intent, agent, session and **cost center** (the chargeback
  dimension: team, customer or feature).
- **`reservations`**: the reserve and settle state machine (`held → settled | released`). A hold
  binds funds against the cap; settle books the actual cost and refunds the rest. Settling is
  exactly-once. The sweeper reclaims a hold left open past `RESERVATION_TTL_SECONDS` (default
  900s).
- **`policies`**: layered ceilings (per transaction, rolling window, cumulative), evaluated against
  each spend at runtime, plus vendor allow and block lists and approval thresholds.
- **`agents` / `sessions`**: identity, session budgets and scoped API keys (SHA-256 hashed).

## Features

- **Overspend invariant**: OCC (`40001`) orders concurrent cross-Region writes to one balance, and
  CHECK constraints refuse any balance below zero or above its cap (`23514`), whoever sends the
  write. A spend that no longer fits is denied, and a `23514` that reaches the app becomes a
  `db_refused` denial.
- **Exactly-once settlement**: reserve, pay, settle, so a retry around an irreversible payment
  can't double-charge; an idempotent sweeper reclaims a crashed hold.
- **Hierarchical budgets**: org → team → agent caps enforced together in one transaction.
- **Policy engine**: per-transaction caps, rolling-window ceilings, vendor allow and block lists,
  and human approval over a threshold, evaluated inside the spend transaction.
- **Policy simulator**: replay the ledger's history against a candidate rule to see how many spends
  it would have blocked and how much it would have saved, before enabling it.
- **Velocity circuit breaker**: runaway spend trips a per-account velocity limit and freezes the
  account.
- **Kill switch**: freeze one agent or the whole fleet with one call.
- **Tamper-evident audit trail**: hash-chained entries verified on demand, with a live
  tamper-detection demo and an accounting **journal export** (CSV for QuickBooks or NetSuite).
- **Cost attribution (chargeback and showback)**: every spend tags a team, customer or feature,
  and spend rolls up by any of them.
- **Incident replay**: run a documented runaway-agent pattern against a budget and watch the cap
  hold, transaction by transaction.
- **Agent registry and scoped API keys**: issue a key bound to one budget account; spends made with
  it are pinned to that agent and attributed.
- **Burn alerts and forecasting**: 50, 80 and 100% thresholds and the projected time until a cap
  is hit.
- **3-line SDK**: drop the budget gate in front of any paid call; money moves only after the spend
  commits.
- **Dashboard**: the org budget, accounts with burn bars, the agent registry, and live ledger and
  denial feeds.
- **Natural-language query**: ask about spend in plain English; the model fills a constrained,
  parameterized query over the ledger, never raw SQL.

## Quickstart

**No AWS account needed.** Stub runs against local Postgres, which raises the same `40001`
serialization failures as Aurora DSQL and enforces the same CHECK constraints, so you exercise the
real retry path and the real invariant:

```bash
npm install
npm run db:up               # Postgres in Docker
echo 'DATABASE_URL=postgres://stub:stub@localhost:5432/stub' >> .env
npm run migrate && npm run seed && npm run seed:activity
npm run dev                 # console at http://localhost:3000
```

Set `DATABASE_URL` and it wins; leave it unset and Stub connects to Aurora DSQL with the `DSQL_*`
vars instead. Local transactions run at `SERIALIZABLE` because plain Postgres needs it to reproduce
DSQL's optimistic concurrency; production DSQL is snapshot-isolated with OCC by default.

For the production path:

```bash
cp .env.example .env        # set DSQL_* (and optionally OPENAI_API_KEY)
npm run check:db            # verify the Aurora DSQL connection
npm run migrate && npm run db:app-role && npm run seed
DSQL_USER=admin npm run seed:drills   # once: the accounts the stress and incident drills use
npm run demo:agent          # an agent spending through the gate (needs the dev server running)
```

In production the app connects as `stub_app`, not `admin`. `npm run migrate` adds
`CHECK (balance_micro >= 0)` to `accounts` and `account_shards`, and
`CHECK (cap_micro IS NULL OR balance_micro <= cap_micro)` to `accounts`, so the database refuses a
negative balance or one raised past its cap. On DSQL it adds each as `NOT VALID` and then validates
it with `ALTER TABLE ASYNC`. `npm run db:app-role` creates `stub_app` with only the grants in
`db/app-role.sql`: no UPDATE or DELETE on `entries`, no DDL. `infra/stub-app-role.yaml` creates the
IAM role Vercel functions assume through OIDC, allowed only `dsql:DbConnect`. Deploy it, map it with
`npm run db:app-role -- grant <role arn>`, then set `AWS_ROLE_ARN` and `ADMIN_TOKEN` on the
project. The stress and incident drills run as `stub_app` against their own `drill-*` accounts,
which `npm run seed:drills` creates once as `admin`. Each drill places concurrent
holds and then releases every one, so it writes only reservations and denials, deletes nothing,
and leaves the budget where it started. The dashboard and query box leave the drill accounts out.

Tests and proofs:

```bash
npm test                    # offline invariant suite (in-memory OCC model, no database needed)
npm run test:local          # local Postgres: 10 agents race one budget, /proof as stub_app
npm run race:bypass         # 10 writers skip the app's check; the CHECK refuses the overspend
npm run harness             # naive-vs-Stub exactly-once comparison (double-pay made visible)
npm run bench               # hot-row contention benchmark, single row vs sharded
npm run sweep               # reclaim reservations held past RESERVATION_TTL_SECONDS (default 900s)
npm run test:live           # live cross-region overspend proof (requires DSQL_ENDPOINT_PEER)
```

## SDK

Published to npm as [`trystub`](https://www.npmjs.com/package/trystub). It has no dependencies
and works anywhere `fetch` exists.

```bash
npm install trystub
```

```ts
import { StubClient } from "trystub";

const stub = new StubClient({ apiKey: process.env.STUB_API_KEY });

if (await stub.guard({ vendorAccountId, amountUsd: 0.02, intent: "fetch market data" })) {
  await doThePaidThing();
}
```

When the payment is irreversible, reserve first, pay once, then settle the real cost:

```ts
import { StubClient } from "trystub";
import { payThroughStub } from "trystub/x402";

const data = await payThroughStub(stub, vendorAccountId, {
  status: 402,
  priceUsd: 0.04,
  intent: "fetch market data",
  costCenter: "Marketing",
  pay: async () => {
    const res = await fetchPaidResource();
    return { result: res.body, actualUsd: res.chargedUsd };
  },
});
```

LLM tokens go through the same hold-then-settle path. `usageFrom` reads OpenAI-shaped and
Anthropic-shaped responses; you supply the rates, because the package ships no price table that
could go stale:

```ts
import { meterLLM, estimateUsd } from "trystub/llm";

const pricing = { inputPerMTok: 3, outputPerMTok: 15 };

const response = await meterLLM(
  stub,
  { vendorAccountId, pricing, estimatedUsd: estimateUsd(promptTokens, maxOutput, pricing) },
  () => callTheModel(),
);
```

The client times out, retries network errors, `429` and `5xx`, and attaches a generated
idempotency key to every `spend` and `reserve`, so a retry resolves to the same ledger entry instead
of charging twice. It ships as both ESM and CommonJS.

Two calls are for whoever operates Stub, not an agent's runtime: construct a client with the
server's `ADMIN_TOKEN` as `apiKey` and call `stub.sweep()` (reclaim expired holds) or
`stub.provisionShards(accountId, shards?)` (shard an account's current balance) instead of
`npm run sweep` or a script. See [sdk/README.md](./sdk/README.md#operator-actions).

## Deployment

Runs as a standard Next.js app on Vercel and holds no AWS keys. Each function assumes the
`stub-app` IAM role (`infra/stub-app-role.yaml`) through Vercel OIDC, gets one-hour credentials,
and may only `dsql:DbConnect` as `stub_app`. Set `AWS_ROLE_ARN`, `DSQL_ENDPOINT`, `DSQL_REGION`,
`ADMIN_TOKEN` and `DSQL_POOL_MAX=1`; add `DSQL_ENDPOINT_PEER` and `DSQL_REGION_PEER` for regional
failover, and `OPENAI_API_KEY` for the natural-language query. The build needs none of them.
Without `ADMIN_TOKEN`, every admin and export route answers 401 in production. Point it at a
multi-Region cluster, two peered Regions plus a witness, and the cross-Region overspend proof runs
against real replication.

Push a `sdk-v*` tag and the `Publish SDK` workflow builds `trystub` and publishes it to npm with
provenance through trusted publishing (GitHub OIDC, no stored token). The maintainer then creates
the [GitHub Release](https://github.com/ashutosh887/stub/releases) with that version's section of
[`sdk/CHANGELOG.md`](./sdk/CHANGELOG.md) as the body; see
[CONTRIBUTING.md](./CONTRIBUTING.md#releasing-the-sdk). To publish by hand:
`cd sdk && npm publish --access public`.

## Operations

- [Incident response](./docs/incident-response.md): one playbook per alarm and rule (OCC
  conflicts, query timeouts, a cluster deletion attempt, the audit trail stopped, GuardDuty changed
  or a finding, a failover, a balance check refusal), the freeze criteria, and recovery with the
  measured restore and failover times.
- [Data classification](./docs/data-classification.md): every table, column, export and log
  classed Public, Internal or Confidential, with retention and where it flows.
- Infrastructure lives in [`infra/`](./infra) as CloudFormation and deploys from `main` through
  [`infra.yml`](./.github/workflows/infra.yml) with a GitHub OIDC role and no stored AWS key.
- Aurora DSQL's SQL audit log records every DDL, role change and write, with the statement and the
  IAM identity behind it, into a per-Region S3 bucket with Object Lock and deletes denied.
- Region failure drill: an AWS FIS template refuses every connection to the primary cluster for
  two minutes. It has run twice against production. The first run found that DSQL drops an open
  connection with `XX000`, which the pool did not recognise. After that fix, the second run moved
  serving to us-east-2 in 17.3 s and found that a dropped connection could crash a function process.
  That is fixed too (see RESULTS.md).
- Measurements: [`measurements/wa-review/RESULTS.md`](./measurements/wa-review/RESULTS.md).

## Development

```bash
npm run lint            # ESLint (eslint-config-next)
npm run format          # Prettier, writes files
npm run typecheck       # strict TypeScript
npm run verify          # lint + typecheck + offline invariant suite
```

Code is formatted with Prettier and linted with ESLint, and the repo installs
[Husky](https://typicode.github.io/husky) git hooks on `npm install`: a **pre-commit** hook runs
lint-staged (ESLint `--fix` and Prettier on staged files) and a **commit-msg** hook enforces
[Conventional Commits](https://www.conventionalcommits.org). CI runs lint, the format check,
typecheck, the offline suite and the build, plus the `db-proof` job on Postgres 17. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT © Ashutosh Jha. See [LICENSE](./LICENSE).
