# Stub

**The general ledger for agent spend.**

_One budget your agents can't break._

> Stub is the general ledger for agent spend: the one budget your fleet can't overspend, because
> the database, not your code, rejects the transaction that would.

**Live:** [trystub.vercel.app](https://trystub.vercel.app) · built on Amazon Aurora DSQL + Next.js on Vercel

---

## What is Stub?

Stub is a strongly-consistent, double-entry **spend ledger** for an organization's fleet of
autonomous AI agents and the money they spend: x402 micropayments, paid APIs, and LLM tokens. It
enforces one company-wide budget that **cannot be overspent** and produces an immutable, queryable
audit trail. The gate that refuses an overspend is one feature of the ledger, not the product.

Think **Ramp / Brex for the agent economy**. As agents move from reading to _spending_ real money,
every company running them needs org-wide budget enforcement and audit-grade books.

## The problem

Agent payment frameworks (e.g. AWS Bedrock AgentCore Payments) give agents wallets, but spending
limits are enforced **per session only**. There is no org-wide, cross-agent, cross-region budget
governance and no audit-grade ledger. A fleet can quietly overspend overnight (every session
within its own limit) and afterward no one can answer the CFO's two questions: **how much did our
agents spend, and on exactly what?**

This is not hypothetical. A single agent stuck in a loop has run up four- and five-figure bills
overnight; one documented storm reached hundreds of thousands of API calls before an account was
suspended. Monitoring and alerts report the overspend _after_ it happens; they can't refuse it.
Stub refuses it before the transaction commits, and keeps books finance can reconcile.

That gap is Stub.

## How it works

A spend that would breach a budget cap **fails the database transaction**. Under concurrent
cross-region writes, Aurora DSQL's optimistic concurrency control returns a serialization failure
(`SQLSTATE 40001`); Stub retries against the fresh balance and either commits or records a denial.
The result is a **zero overspend window**, guaranteed by the database rather than by application
locking or luck.

The contended row is the lock: a spend debits its account and rolls every ancestor balance up the
hierarchy in the same transaction, so concurrent agents racing the same budget serialize on a
shared row and the loser conflicts. This is why the invariant holds across regions where row locks
(`SELECT … FOR UPDATE`) don't exist.

### The non-obvious part: exactly-once around an irreversible payment

A naive retry around OCC has a sharp edge. If the payment is sent _inside_ the retried transaction,
a serialization conflict re-runs the block and **pays again**: real money, gone twice. Stub splits
the flow the way card networks do: **reserve → pay → settle**. The estimate is held against the cap
in one transaction; the irreversible payment fires exactly once, guarded by an idempotency key,
_outside_ the transaction; then a second transaction settles the actual cost and refunds the
difference. OCC retries only ever replay the ledger, never the payment. A crash between pay and
settle is reclaimed by an idempotent sweeper: settle and sweep contend on the hold row, OCC picks
one winner, the other is a no-op.

```
Agent (x402 / AgentCore)
  → 3-line SDK ─ guard() · reserve → pay → settle
  → Stub API (Next.js route: auth · rate-limit · request id)
      → policy + hierarchy + velocity check
      → atomic double-entry write under Aurora DSQL OCC ──(40001)──► retry / deny + denial entry
  → immutable, hash-chained ledger
      → mission-control dashboard (live) · incident replay · audit · attribution · NL query
```

## Proven, not asserted

The invariants are demonstrated, not just claimed:

- **`npm run harness`** races a naive retry against Stub under concurrent writers with crashes
  injected after payment. The naive baseline double-pays: it sends ~$43 of payments against a $3
  budget; Stub sends exactly what committed, leaves no stuck holds, and never goes negative. The
  same assertions run in CI (`npm test`).
- **`npm run test:live`** runs the real cross-region race: six agents in two AWS regions hit one
  near-empty budget on the live cluster; exactly what fits commits, the rest deny with real
  `40001`s, the balance never goes negative.
- **The audit page** re-verifies the hash chain and demonstrates tamper detection on a throwaway
  copy of a real entry; the live ledger is never touched.

### The known ceiling

The contended balance row is what makes the invariant work, and it is also the throughput limit.
`npm run bench` measures it. On local Postgres, throughput against a single budget stays flat around
300-450 ops/sec no matter how many writers pile on, while conflicts per spend climb past 2 and p95
latency goes from ~13 ms at 1 writer to ~380 ms at 32. Adding writers buys nothing.

`core/sharded.ts` splits one balance into N shard rows. Each shard is checked and debited
independently, so writers collide less, and because no shard ever goes below zero, the sum cannot
either: **sharding relaxes throughput without weakening the overspend invariant.** A spend takes
one shard on the fast path and only reads the others when that shard is short, so it borrows across
shards instead of falsely denying a spend that fits. Measured at 8 shards on local Postgres, that is
a 1.2-2.8x throughput gain with equal or lower conflicts per spend.

Sharding is opt-in per account: provisioning an account with `provisionShards` flips its `sharded`
flag, and `/api/spend` dispatches to the sharded path automatically for any account with that flag
set (`core/sharded.ts` `spendAuto`), with the same policy, frozen, velocity, and hierarchy checks
either way. The console has no UI to provision a sharded account yet; that's an admin-gated
`POST /api/accounts/shard` call, or `stub.provisionShards(accountId)` from the SDK.
The definitive numbers belong on the real DSQL cluster, where reads do not conflict at all; the
local figures understate the gain.

## Why Aurora DSQL

Budget-enforcement correctness _is_ the database's consistency model. The load-bearing property is
**active-active, multi-region strong consistency**: a writer in `us-east-1` and a writer in
`us-east-2` hitting the same balance resolve to one consistent outcome. No other AWS database
offers it: Aurora PostgreSQL Global is single-writer, and DynamoDB global tables are eventually
consistent (last-writer-wins → silent overspend during replication). Swap the database and the core
safety feature breaks.

## Architecture

| Layer    | Choice                                                                |
| -------- | --------------------------------------------------------------------- |
| Database | **Amazon Aurora DSQL**: strong consistency + OCC (load-bearing)       |
| Driver   | `pg` over the Aurora DSQL Node connector (automatic IAM tokens)       |
| API      | Next.js App Router route handlers (Node runtime)                      |
| Frontend | Next.js + Tailwind                                                    |
| Deploy   | Vercel                                                                |
| NL query | OpenAI function-calling, with a deterministic offline parser fallback |
| SDK      | `trystub` on npm: dependency-free `fetch` client                      |

```mermaid
flowchart LR
  A[Agent fleet<br/>x402 / AgentCore] -->|trystub SDK| B[Stub API<br/>Next.js on Vercel]
  B --> C{policy · hierarchy<br/>velocity · idempotency}
  C -->|reserve / spend| D[(Amazon Aurora DSQL<br/>us-east-1 + us-east-2<br/>strong consistency · OCC)]
  D -->|40001| C
  C -->|pay once| P[Payment rail<br/>x402 testnet]
  C --> L[Immutable hash-chained ledger<br/>double-entry + receipts]
  L --> V[Console<br/>dashboard · incident · settlement<br/>audit · attribution · NL query]
```

The codebase keeps the domain pure and the database swappable:

```
core/   pure, dependency-free domain: ledger, settlement, sharding, harness, policy, hash, query
db/     the Postgres-family adapter: pool, Store implementation, schema.sql (DSQL or plain Postgres)
sdk/    the drop-in client (published to npm as trystub) + x402 / AgentCore adapter + LLM metering
app/    Next.js console: dashboard · incident · settlement · audit · attribution + API routes
config/ env + SEO single source of truth   scripts/  migrate · seed · harness · bench · sweep · demo-agent
test/   invariant suite (overspend, exactly-once, hash chain) · local Postgres · live cross-region
```

## Data model

A deliberate double-entry ledger:

- **`accounts`**: budget accounts (org → team → agent → vendor), each with a balance, a hard cap,
  and an optional velocity limit. A spend is bound by the **tightest cap up the hierarchy**: it
  debits the named account and rolls up every ancestor's balance in the same transaction.
- **`entries`**: immutable double-entry lines; the append-only audit log. Each carries a compressed
  JSON receipt of the full payment context and is **hash-chained** (`prev_hash → hash`) so any
  altered or removed row is detectable. Every line is attributed to a user, intent, agent, session,
  and **cost center** (the chargeback dimension: team, customer, or feature).
- **`reservations`**: the reserve→settle state machine (`held → settled | released`). A hold binds
  funds against the cap; settle books the actual cost and refunds the rest. Settling is exactly-once.
  A hold left open past `RESERVATION_TTL_SECONDS` (default 900s) is reclaimed by the sweeper.
- **`policies`**: layered ceilings (per-transaction · rolling window · cumulative), evaluated against
  each spend at runtime, plus vendor allow/blocklists and approval thresholds.
- **`agents` / `sessions`**: identity, session budgets, and scoped API keys (SHA-256 hashed).

## Features

- **Overspend invariant**: concurrent cross-region writes that would breach a cap fail with
  `SQLSTATE 40001` and are recorded as denials; the balance never goes negative.
- **Exactly-once settlement**: reserve → pay → settle so a retry around an irreversible payment
  can't double-charge; a crashed hold is reclaimed by an idempotent sweeper.
- **Hierarchical budgets**: org → team → agent caps enforced together in one transaction.
- **Policy engine**: per-transaction caps, rolling-window ceilings, vendor allow/blocklists, and
  human-in-the-loop approval thresholds, evaluated inside the spend transaction.
- **Policy simulator**: replay the immutable history against a candidate rule ("this would have
  blocked 7 spends and saved $340") before enabling it.
- **Velocity circuit-breaker**: runaway spend trips a per-account velocity limit and auto-freezes
  the account.
- **Kill-switch**: freeze a single agent or the entire fleet instantly.
- **Tamper-evident audit trail**: hash-chained entries verified on demand, with a live
  tamper-detection demo and an accounting **journal export** (CSV for QuickBooks / NetSuite).
- **Cost attribution (chargeback / showback)**: every spend tags a team, customer, or feature;
  roll spend up by any of them to answer who drove it.
- **Incident replay**: unleash a documented runaway-agent pattern at a budget on the live cluster
  and watch the cap hold, transaction by transaction.
- **Agent registry + scoped API keys**: issue a key bound to one budget account; spends made with
  it are pinned to that agent and attributed.
- **Burn alerts + forecasting**: 50 / 80 / 100% thresholds and projected runway until a cap is hit.
- **3-line SDK**: drop the budget gate in front of any paid call; money moves only after the spend
  commits.
- **Mission-control dashboard**: org guardrail, accounts with burn bars, the agent registry, and
  live ledger + denial feeds.
- **Natural-language query**: ask about spend in plain English; the model fills a constrained,
  parameterized query over the ledger, never raw SQL.

## Quickstart

**No AWS account needed.** Stub runs against local Postgres, which raises the same `40001`
serialization failures as Aurora DSQL, so you exercise the real retry path and the real invariant:

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
npm run demo:agent          # an agent spending through the gate (needs the dev server running)
```

In production the app connects as `stub_app`, not `admin`. `npm run migrate` adds
`CHECK (balance_micro >= 0)` to the balance tables, so the database itself refuses a negative
balance. `npm run db:app-role` creates `stub_app` with only the grants in `db/app-role.sql`: no
UPDATE or DELETE on `entries`, no DDL. `infra/stub-app-role.yaml` creates the IAM role Vercel
functions assume through OIDC, allowed only `dsql:DbConnect`. Deploy it, map it with
`npm run db:app-role -- grant <role arn>`, then set `AWS_ROLE_ARN` and `ADMIN_TOKEN` on the
project. The stress and incident drills delete their own rows, so they run only as `admin` or on
local Postgres.

Tests & proofs:

```bash
npm test                    # offline invariant suite (in-memory OCC model, no database needed)
npm run test:local          # 10 agents race one budget on local Postgres, real 40001s
npm run harness             # naive-vs-Stub exactly-once comparison (double-pay made visible)
npm run bench               # hot-row contention benchmark, single row vs sharded
npm run sweep               # reclaim reservations held past RESERVATION_TTL_SECONDS (default 900s)
npm run test:live           # live cross-region overspend proof (requires DSQL_ENDPOINT_PEER)
```

## SDK

Published to npm as [`trystub`](https://www.npmjs.com/package/trystub): dependency-free,
works anywhere `fetch` exists.

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

The client times out, retries network errors / `429` / `5xx`, and attaches a generated idempotency
key to every `spend` and `reserve` so a retry resolves to the same ledger entry instead of charging
twice. It ships as both ESM and CommonJS.

Two calls are for whoever operates Stub, not an agent's runtime: construct a client with the
server's `ADMIN_TOKEN` as `apiKey` and call `stub.sweep()` (reclaim expired holds) or
`stub.provisionShards(accountId, shards?)` (shard an account's current balance) instead of
`npm run sweep` / a script. See [sdk/README.md](./sdk/README.md#operator-actions).

## Deployment

Runs as a standard Next.js app on Vercel. The API routes connect to Aurora DSQL via the AWS
credential chain, so the deployment needs `DSQL_ENDPOINT`, `DSQL_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, and `OPENAI_API_KEY` set as environment variables (with `DSQL_POOL_MAX=1`
for serverless). Point it at a multi-region cluster, two peered regions plus a witness, and the
cross-region overspend proof runs against real replication rather than a simulation.

The SDK publishes itself: push a `sdk-v*` tag (with an `NPM_TOKEN` repo secret set) and the
`Publish SDK` workflow builds and ships `trystub` to npm with provenance, then opens the matching
[GitHub Release](https://github.com/ashutosh887/stub/releases) using that version's section of
[`sdk/CHANGELOG.md`](./sdk/CHANGELOG.md) as the body. The changelog is the single source of truth
for release notes; see [CONTRIBUTING.md](./CONTRIBUTING.md#releasing-the-sdk). To publish manually:
`cd sdk && npm publish --access public`.

## Development

```bash
npm run lint            # ESLint (eslint-config-next)
npm run format          # Prettier write
npm run typecheck       # strict TypeScript
npm run verify          # lint + typecheck + offline invariant suite
```

Code is formatted with Prettier and linted with ESLint, and the repo installs
[Husky](https://typicode.github.io/husky) git hooks on `npm install`: a **pre-commit** hook runs
lint-staged (ESLint `--fix` + Prettier on staged files) and a **commit-msg** hook enforces
[Conventional Commits](https://www.conventionalcommits.org). See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the full standards.

## License

MIT © Ashutosh Jha. See [LICENSE](./LICENSE).
