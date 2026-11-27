# Stub

> **The general ledger for agent spend.**

Stub is a strongly-consistent, double-entry spend ledger that sits between an organization's fleet
of autonomous AI agents and the money they spend (x402 micropayments, paid APIs, LLM tokens). It
enforces one company-wide budget that **cannot** be overspent and produces an immutable, queryable
audit trail. Tagline: _"One budget your agents can't break."_

---

## Core invariant (the whole product in one sentence)

> A write that would take a balance below zero or above its cap **is refused by the database**:
> `CHECK` constraints on every balance row fail it with SQLSTATE `23514`, whichever role or code path
> sent it. Concurrent cross-region writers are serialised by Aurora DSQL's optimistic concurrency
> control (`40001`); Stub retries against the fresh balance, or denies and records a denial entry. A
> `23514` that reaches the app is recorded as a `db_refused` denial. OCC decides the order of the
> writes; the `CHECK` decides whether a write is affordable. Result: **zero overspend window**,
> enforced by the database, not by application code or locking.

## Why Aurora DSQL is load-bearing

- Correctness here **is** the database's consistency model. The load-bearing property is
  **active-active, multi-region strong consistency**: a writer in each region hitting the same
  balance resolves to one consistent outcome. No other AWS database offers it (Aurora PostgreSQL
  Global is single-writer; DynamoDB global tables are eventually consistent). Swap the database and
  the safety feature breaks.
- DSQL has **no pessimistic row locks** (`SELECT … FOR UPDATE`). The invariant rests on a contended
  mutable `balance` row that every spend `UPDATE`s, so concurrent writers collide and OCC forces the
  loser to conflict. A purely append-only design would **not** be safe under snapshot isolation:
  two racing inserts touch different rows, neither conflicts, and the budget goes negative.
- PostgreSQL-16 compatible, OCC / snapshot isolation, ACID, scales to zero.

---

## Architecture

```
Agent (x402 / AgentCore adapter)
  → 3-line SDK, guard()
  → Stub API (Next.js route, withRoute: auth, rate-limit, request id)
      → policy + hierarchy + velocity check
      → atomic double-entry write under DSQL OCC ── on 40001 → retry / deny + denial entry
  → immutable, hash-chained ledger → dashboard (live), natural-language query
```

### Data model (deliberate double-entry)

- `accounts`: budget accounts (org → team → agent → vendor), each with a balance, hard cap, and
  optional velocity limit. A spend binds to the **tightest cap up the hierarchy** and rolls every
  ancestor's balance up in the same transaction.
- `entries`: **immutable** double-entry lines; the append-only audit log. Every spend = atomic
  debit of a budget + credit of a vendor in one ACID transaction. Includes a JSON receipt column,
  attribution columns (user, intent, timestamp, agent, session, **cost_center** for chargeback),
  and a **hash chain** (prev-hash) for tamper-evidence.
- `reservations`: the reserve→pay→settle state machine (`held → settled | released`). A hold
  decrements the balance up the hierarchy in one txn (enforcing the cap at reserve time); settle
  books the actual cost + refunds the difference; both settle and release are **exactly-once** via
  the reservation row under OCC. The irreversible payment fires once, outside the txn, keyed on the
  reservation. A crashed hold past `RESERVATION_TTL_SECONDS` is reclaimed by an idempotent sweeper
  (`sweepExpiredReservations`, `npm run sweep` or `POST /api/sweep`): it releases the hold via the
  same `release()` path an agent would call, so it contends on the reservation row under OCC exactly
  like any other release and can never double-refund a hold another process is settling.
- `policies`: layered ceilings (per-transaction, rolling window, cumulative), vendor
  allow/blocklists, approval thresholds, evaluated against each spend at runtime.
- `agents` / `sessions`: identity, session budgets, scoped API keys (SHA-256 hashed).
- `query_cache`: caches NL-query answers, keyed on question + a ledger fingerprint (entry/denial
  counts), so repeats are free but any new spend yields a fresh answer.

### DSQL features

- **GA (the core depends only on these):** strong consistency, OCC / snapshot isolation, ACID
  transactions, identity columns/sequences, JSON type + compression (receipt column), Node.js
  connector with automatic IAM token generation (don't hand-roll IAM tokens), `CHECK` constraints
  (added to an existing table as `NOT VALID`, then `ALTER TABLE ASYNC … VALIDATE CONSTRAINT`).
- **Not used yet:** DSQL CDC streams (GA since July 2026; a streaming dashboard and anomaly breaker
  are roadmap, app-layer polling is what ships). **Preview:** the AgentCore Payments adapter (thin,
  mockable, testnet only, never mainnet USDC).

### DSQL constraints to respect

No triggers, ~3,000-row transaction cap, 1MB row-size limit, PostgreSQL-16 _subset_, OCC requires
app-level retry on `40001`, IAM tokens refreshed automatically by the connector, multi-Region
clusters are two peered Regions plus a witness. Stub's schema uses no foreign keys (DSQL has
supported them since August 2026); references are checked in the transaction that writes them.

**Never commit environment-specific or account-specific details.** No cluster IDs or endpoints,
account IDs, hosting team/project IDs, tokens, keys, personal emails, or local machine paths, in
this file or any tracked file. Configuration belongs in env vars, documented by name only in
`.env.example`. Keep docs written for anyone deploying Stub, not for one particular deployment.

---

## The gap Stub fills

Agent payment frameworks (e.g. AgentCore Payments) enforce spend limits **per session only**. There
is no org-wide, cross-agent, cross-region budget governance and no audit-grade ledger. Stub is that
layer: the system of record across the whole fleet.

## Conventions & guardrails for development

- Build the core first (double-entry ledger + OCC overspend prevention on **GA** DSQL features);
  enhancement layers (CDC, AgentCore) are layered and degradable.
- Prove the overspend invariant with a concurrency test.
- Keep the agent side minimal; a mockable x402/AgentCore adapter is enough. The ledger is the star.
- Keep every transaction well under the 3,000-row cap; avoid unsupported PG features.
- Never depend on preview APIs or mainnet funds for core functionality.
- Write clean, self-explanatory code with no comments by default. Imports use the `@/*` alias
  (tsconfig root); no `../../`.

## Product surfaces

Shipped:

- **Budget & policy:** hierarchy + inheritance (org→team→agent→session), soft/hard caps, threshold
  alerts (50/80/100%), time windows, vendor allow/blocklists, human-in-the-loop approval over $X,
  global + per-agent kill-switch, rate limiting.
- **Audit-grade trust:** tamper-evident hash-chained entries, full JSON receipt capture, journal-line
  CSV export, idempotency keys (no double-charge).
- **Attribution:** cost attribution to teams/customers/features via `cost_center`, chargeback/
  showback rollups.
- **Spend safety:** spend-velocity auto-freeze (circuit breaker), forecasting/projected burn.
- **Integration:** 3-line SDK, x402/AgentCore adapter, LLM token metering, NL-query server, agent
  identity + scoped API keys.

Roadmap (**not built**, do not describe these as shipped): Stripe/AP2 adapters, Slack/email/webhook
alerts, RBAC, multi-tenancy, sandbox/test mode, usage-based billing, multi-provider cost
normalization, CDC→Kinesis live feed.

## Repo layout

- `core/`: **pure, dependency-free domain**. `ledger.ts` (store-agnostic `spend()` + `runOcc`/
  `buildEntry` helpers + the hierarchy walk + velocity breaker), `settlement.ts` (reserve/settle/
  release + `sweepExpiredReservations`, all exactly-once), `payment.ts` (gateway interface +
  counting mock), `harness.ts` (naive-vs-Stub exactly-once proof), `store.ts` (`Store`/`Tx`
  interface), `mem-store.ts` (in-memory OCC model for offline tests), `sharded.ts` (per-account
  opt-in sharded balances for hot-row contention: `provisionShards` (leaf accounts only; it refuses
  an account with children) flips an account's `sharded` flag, and `spendAuto`, which `/api/spend`
  uses, dispatches to `shardedSpend` or the plain `spend()`
  based on that flag, with full policy/frozen/velocity/hierarchy parity either way), `policy.ts`,
  `query.ts`, `audit.ts`, `hash.ts`, `burn.ts`, `forecast.ts`, `apikey.ts`. No `pg`/AWS imports here.
- `db/`: the **Postgres-family adapter**. `client.ts` (`createPool` for DSQL + IAM,
  `createPostgresPool` for a plain `DATABASE_URL`, `createDriverPool`/`getPool` dispatching on
  `config.db.driver`), `pg-store.ts` (`Store` impl, standard SQL only; opens transactions
  `SERIALIZABLE` on plain Postgres so it raises the same `40001` as DSQL's OCC), `schema.sql`
  (single source of truth, idempotent; `CREATE INDEX ASYNC` is rewritten to `CREATE INDEX` by
  `npm run migrate` on the postgres driver). Swap this dir, the core is untouched.
- **Regional failover:** with `DSQL_ENDPOINT_PEER` set, `getPool()` returns a `FailoverPool`
  (`db/failover.ts`): a connection the primary cannot open (network error, connect timeout, SQLSTATE
  class `08`/`28`/`57P0x`, or `XX000 internal error`, which is how DSQL drops an open connection,
  and the dropped client is discarded) is retried on the peer at once and later calls stay there; after
  `DSQL_FAILBACK_AFTER_MS` a background probe moves them back when the primary answers. SQL errors
  (`40001`, `23514`, `42501`) never switch. `PgStore.transaction` and `FailoverPool.query` listen
  for `error` on the client they hold (`pg` emits it when a checked-out connection drops, and with no
  listener the process exits), skip the rollback on a dead connection and release it as broken. The
  stress and incident drills take `createBurstPool(n)`, which fails over the same way. Either endpoint is correct: the peers are strongly
  consistent. `PgStore` takes any `Connectable`; `/api/health` reports the active Region.
  `npm run drill:failover [blackhole|dns]` measures time to the first committed spend on the peer
  from one client; the AWS FIS template `stub-dsql-primary-connection-failure` (us-east-1
  `stub-clusters`, `FaultInjectionDrill=enabled`) refuses every connection to the primary for 2
  minutes against the real deployment. Never probe production as `admin` inside `BEGIN … ROLLBACK`:
  on DSQL a failed statement ends the transaction and the next one runs in autocommit.
- **Two drivers, one code path:** set `DATABASE_URL` for local Postgres (`npm run db:up`,
  `docker-compose.yml`) and every `DSQL_*` var is ignored; leave it unset for Aurora DSQL. Local
  mode is a faithful OCC model, not a mock, so `npm run test:local` proves the invariant with no
  AWS account.
- `sdk/`: the **drop-in SDK** (`index.ts` `StubClient` with `guard`/`spend`/`reserve`/`settle`/
  `release`, plus per-call timeout, bounded retry on network/`429`/`5xx`, and a generated
  idempotency key on `spend`/`reserve` so a retry can never double-charge) + thin mockable
  x402/AgentCore adapter (`x402.ts` `payThroughStub`) + LLM token metering (`llm.ts` `meterLLM`,
  `usageFrom`, `costUsd`, `estimateUsd`). **Ships no model price table on purpose**: prices go
  stale, so the caller supplies rates; only the stable OpenAI/Anthropic usage shapes are adapted.
  Also `sweep()`/`provisionShards(accountId, shards?)`: operator-only methods (construct the
  client with `ADMIN_TOKEN` as `apiKey`, not an agent's scoped key) hitting the admin-gated
  `POST /api/sweep` / `POST /api/accounts/shard` routes. Dependency-free; dual ESM + CJS build
  (`tsconfig.json` → `dist/esm`, `tsconfig.cjs.json` → `dist/cjs`); **published to npm as
  `trystub`**, shipped by the `Publish SDK` workflow on a `sdk-v*` tag (builds, publishes with
  provenance over npm trusted publishing, so no npm token is stored). The workflow does not
  create the GitHub Release: the maintainer creates it from their own account with that version's
  `sdk/CHANGELOG.md` section, so it never shows a bot as the releaser. Release steps live in `CONTRIBUTING.md` → "Releasing the SDK":
  rename `## [Unreleased]` to the version, bump
  `sdk/package.json` to match (the workflow fails if they disagree), commit, tag `sdk-vX.Y.Z`,
  push the tag.
- `config/`: single source of truth for env-driven values (`index.ts`): `db`, `dsql`, `openai`,
  `app`, `demo`, `limits`, plus `requiredEnv` (lazy). `core/` and `sdk/` stay config-free.
- `app/` `components/` `lib/`: Next.js (App Router) multipage console + API routes + server helpers.
  App pages: `/dashboard` (overview), `/incident` (replay), `/settlement` (reserve→pay→settle),
  `/audit` (chain verification + journal export), `/attribution` (chargeback/showback), all sharing
  the `AppTabs` sub-nav. Marketing pages `/`, `/how-it-works` and `/proof` share `SiteNav` (logo mark +
  `NpmStatsLink` hover tooltip showing latest npm version + GitHub stars) and `SiteFooter`, and
  build from `components/site-kit.tsx` (`SiteSection` with its margin column of source files,
  `Stamp` for a refused SQLSTATE, link and code primitives). Marketing copy cites only numbers in
  `measurements/wa-review/RESULTS.md`, with no em/en dashes or interpuncts. Every
  route runs through `lib/api.ts` `withRoute` (request id, sanitized errors, admin auth, rate
  limit); page-level gating via `adminPageAllowed`. Auth is enforced when `ADMIN_TOKEN` is set;
  unset, it is open in development and closed in production. `/proof` is public: its button posts to
  `POST /api/proof` (`lib/proof.ts` `runProof`), which sends six statements as the app's own
  connection, each in its own `BEGIN … ROLLBACK`, and returns the SQLSTATE per statement; it refuses
  to probe unless `current_user` is `stub_app` and does not own the tables, and is rate limited per
  IP and overall. After the probes, in a separate statement, it records the run in `proof_runs`
  (`lib/proof-runs.ts`; `stub_app` may only `INSERT` and `SELECT` there) and returns the visitor
  tally, which `GET /api/proof` also serves, edge-cached; a missing table or a failed write only
  hides the counter. Below the button, `components/race-chart.tsx` plots the bypass race from
  `measurements/wa-review/dsql-race-{before,after}.json`, imported at build time by `lib/race.ts`,
  which derives every number and sentence from the runs; `app/proof/opengraph-image.tsx` draws the
  same lines for the share card. Its before/after table copies numbers only from
  `measurements/wa-review/RESULTS.md`.
- **Branding & SEO** (in `app/`): logo assets (`icon.png`, `apple-icon.png`, `public/logo.png`,
  all derived from one gold-on-ink mark), dynamic `opengraph-image.tsx` + `twitter-image.tsx`
  (1200×630 via `next/og`), rich metadata + `SoftwareApplication` JSON-LD in `layout.tsx`,
  per-page canonicals (the JSON-LD `softwareVersion` reads `sdk/package.json`), `sitemap.ts` / `robots.ts` (answer-engine crawlers named, `/api/` closed to all), and `llms.txt/route.ts`, a static plain-text summary for answer engines built from `config/seo.ts` and `lib/race.ts`, so it cites the same numbers as `/proof`.
- `scripts/`: operational commands (migrate/seed/seed:activity/check/demo-agent/bench/sweep,
  drill:failover, ledger:fingerprint).
  `test/`: `invariant/` (offline), `local/` (local Postgres), `live/` (real cluster). `docs/`:
  local-only planning notes (gitignored), except `incident-response.md` (one playbook per alarm
  and rule) and `data-classification.md` (class, retention and flow of every table and export),
  which are tracked and linked from the README.

## Commands

- Dev: `npm run dev`, Build: `npm run build`, Typecheck: `npm run typecheck`
- Lint/format: `npm run lint`, `npm run format`, `npm run verify` (lint + typecheck + invariant).
  Husky hooks run lint-staged on pre-commit and commitlint on commit-msg (Conventional Commits).
- Local DB (no AWS): `npm run db:up`, `npm run db:down` (needs `DATABASE_URL` set)
- DB: `npm run check:db`, `npm run migrate`, `npm run db:app-role`, `npm run seed`,
  `npm run seed:activity`, `npm run seed:drills` (once, as `admin`: the root-level `drill-*`
  accounts the `/api/stress` and `/api/incident` drills run against, with fixed ids from
  `lib/drills.ts`. Drills reserve then release, so they run as `stub_app`, delete nothing and
  restore the balance; `lib/data.ts` leaves the drill accounts out of accounts, denials,
  reservations and NL queries)
- **Least privilege:** the app connects as `stub_app` (the `DSQL_USER` default), never `admin`;
  `db/app-role.sql` holds its grants (no UPDATE/DELETE on `entries`, no DDL) and
  `infra/stub-app-role.yaml` the OIDC-assumed IAM role (only `dsql:DbConnect`).
  `test/invariant/least-privilege.test.ts` fails CI if either widens. Balances carry
  `CHECK (balance_micro >= 0)` (`accounts`, `account_shards`) and `accounts` also
  `CHECK (cap_micro IS NULL OR balance_micro <= cap_micro)`, so the app role can neither overspend
  nor mint budget past a cap (vendors have no cap; shards have no cap column, so a shard is bounded
  below only). DSQL accepts a CHECK only as `ADD CONSTRAINT … NOT VALID` followed by
  `ALTER TABLE ASYNC … VALIDATE CONSTRAINT`, which `npm run migrate` does for every constraint in
  `db/schema.sql`. Before adding one on a live cluster, count the rows that break it: a `NOT VALID`
  constraint already refuses new writes to such a row.
- **Infrastructure as code** (`infra/`, CloudFormation, every stack with termination protection;
  change live resources only through these templates and confirm with drift detection):
  `stub-app-role.yaml` (OIDC provider + app role), `stub-clusters.yaml` (one stack per Region,
  created by importing the running cluster: deletion protection, `DeletionPolicy: Retain`, the
  cluster policy that denies `DbConnect` to all but the app role and operators and
  `DbConnectAdmin` to all but operators, the DSQL SQL audit log delivery (`AUDIT_LOGS`) to a
  per-Region S3 bucket with Object Lock in governance mode and deletes denied, and in us-east-1 the
  FIS drill template and its role; the audit baseline itself is SQL,
  `ALTER SYSTEM SET dsql_audit.log = 'ddl,role,write'`, run once as `admin`), `stub-backup.yaml` (one per Region; deploy the peer
  Region first, then the primary with `CopyToVaultArn` set to the peer vault), `stub-audit.yaml`
  (once, in the home Region: multi-Region trail, log bucket, AWS Config service-linked role) and
  `stub-detection.yaml` (one per Region, after `stub-audit`: GuardDuty, alarms, SNS, EventBridge
  rules, Config recorder and rule) and `stub-deploy-role.yaml` (once, by an operator: GitHub OIDC
  provider, `stub-infra-deploy` limited to change sets on the five stack names through
  `stub-infra-cfn-exec`, which is denied every audit and ledger kill switch).
  `.github/workflows/infra.yml` lints and tests on PR and deploys the stacks from `main`, refusing
  any change set that removes or replaces a resource. `test/invariant/infrastructure.test.ts` fails
  CI if a control is dropped from a template; `cfn-lint` runs in `security.yml`. Every route under
  `app/api` must be `admin: true`, agent-key, or on the reasoned public list
  (`test/invariant/route-guard.test.ts`). Restore check:
  `npm run ledger:fingerprint -- <endpoint> <region>` on the source and the restored cluster must
  print the same counts and digests.
- Demo agent (needs `npm run dev`): `npm run demo:agent`
- Offline invariant gate (in-memory OCC, no database): `npm test` / `npm run test:invariant`
- **Local overspend proof** (real `40001`s on local Postgres, auto-skips without `DATABASE_URL`):
  `npm run test:local`
- **Bypass race** (writers that skip `guard()` and `UPDATE` the balance directly, as `stub_app` by
  default; `--as owner` to compare): `npm run race:bypass`. Only the `CHECK` stops it.
  `test/local/db-guardrail.test.ts` runs it plus the `/proof` probes as `stub_app`; the `db-proof`
  CI job runs it on `postgres:17` (local Postgres logs in with `STUB_APP_PASSWORD`).
- **Database guardrail action** (`.github/actions/db-guardrail`, composite; `runner.mjs` depends
  only on `pg`, pinned in its own lockfile): sends each probe from a JSON file inside
  `BEGIN … ROLLBACK` and fails on any probe not refused with its `expect` SQLSTATE; refuses to run
  as a superuser or an owner of a probed table. Public as
  `uses: ashutosh887/stub/.github/actions/db-guardrail@<ref>`. `db-proof` runs it after
  `npm run seed` with `test/guardrail/probes.json`, which
  `test/invariant/guardrail-probes.test.ts` keeps identical to `PROOF_PROBES`.
- **Exactly-once harness** (naive double-pay vs Stub, prints pass/fail): `npm run harness`
- **Contention benchmark** (single balance row vs sharded, sweeps 1→32 writers): `npm run bench`
- **Reservation TTL sweep** (reclaims holds stuck past `RESERVATION_TTL_SECONDS`, default 900s):
  `npm run sweep`, or `POST /api/sweep` (admin-gated) for an external scheduler to call
- **Provision a sharded account**: `POST /api/accounts/shard` (admin-gated) or SDK
  `stub.provisionShards(accountId, shards?)`. It shards the account's current balance, refuses to
  run twice on the same account
- **Live cross-region overspend proof:** `npm run test:live` (`test/live/cross-region.test.ts`):
  6 agents across two regions race one near-empty budget on the real cluster → exactly what fits
  commits, the rest deny with real OCC `40001`s, balance never negative. Auto-skips without
  `DSQL_ENDPOINT_PEER`, self-cleans.

## Natural-language query

"Ask your ledger" turns a plain-English question into a constrained, **parameterized** query over
`entries`/`denials`; the question side never produces raw SQL. `core/query.ts` `LedgerQuery` +
`runLedgerQuery` (`lib/data.ts`) + `summarize`.

- **Primary engine: OpenAI** (`lib/ai.ts`, official `openai` SDK, function-calling; `gpt-4o-mini`
  by default via `OPENAI_MODEL`; reads `OPENAI_API_KEY`).
- **Fallback: a deterministic parser**: `parseQuestion()` in `core/query.ts`, pure/offline, so the
  box always answers. Response carries `engine: "openai" | "parser" | "cache"`.
- **Cache:** answers are cached in DSQL keyed on question + ledger fingerprint (see `query_cache`).
- The account filter matches a team _or its agents_ (so "Marketing" catches research-agent).
- `groupBy` includes `costCenter` so the box can answer chargeback/showback questions ("spend by
  cost center", "by customer") over the same parameterized query path.
