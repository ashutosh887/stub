# Stub

> **The general ledger for agent spend.**

Stub is a strongly-consistent, double-entry spend ledger that sits between an organization's fleet
of autonomous AI agents and the money they spend (x402 micropayments, paid APIs, LLM tokens). It
enforces one company-wide budget that **cannot** be overspent and produces an immutable, queryable
audit trail. Tagline: _"One budget your agents can't break."_

---

## Core invariant (the whole product in one sentence)

> A spend that would breach a budget cap **fails the database transaction**. Under concurrent
> cross-region writes, Aurora DSQL's optimistic concurrency control returns a serialization failure
> (SQLSTATE `40001`); Stub retries against the fresh balance, or denies and records a denial entry.
> Result: **zero overspend window**, guaranteed by the database, not by application locking.

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
  → 3-line SDK · guard()
  → Stub API (Next.js route, withRoute: auth · rate-limit · request id)
      → policy + hierarchy + velocity check
      → atomic double-entry write under DSQL OCC ── on 40001 → retry / deny + denial entry
  → immutable, hash-chained ledger → dashboard (live) · natural-language query
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
  reservation. A crashed hold is reclaimed by an idempotent sweeper.
- `policies`: layered ceilings (per-transaction · rolling window · cumulative), vendor
  allow/blocklists, approval thresholds, evaluated against each spend at runtime.
- `agents` / `sessions`: identity, session budgets, scoped API keys (SHA-256 hashed).
- `query_cache`: caches NL-query answers, keyed on question + a ledger fingerprint (entry/denial
  counts), so repeats are free but any new spend yields a fresh answer.

### DSQL features

- **GA (the core depends only on these):** strong consistency, OCC / snapshot isolation, ACID
  transactions, identity columns/sequences, JSON type + compression (receipt column), Node.js
  connector with automatic IAM token generation (don't hand-roll IAM tokens).
- **Preview (enhancement layers, degrade gracefully):** DSQL CDC → Kinesis (streaming dashboard +
  anomaly breaker; app-layer polling is the shipped fallback); AgentCore Payments adapter (thin,
  mockable, testnet only, never mainnet USDC).

### DSQL constraints to respect

No foreign keys, no triggers, ~3,000-row transaction cap, 1MB row-size limit, PostgreSQL-16
_subset_, OCC requires app-level retry on `40001`, IAM tokens refreshed automatically by the
connector, multi-region clusters restricted to one geographic grouping. Cluster: us-east-1 +
us-east-2 with a us-west-2 witness.

---

## The gap Stub fills

Agent payment frameworks (e.g. AgentCore Payments) enforce spend limits **per session only**. There
is no org-wide, cross-agent, cross-region budget governance and no audit-grade ledger. Stub is that
layer: the system of record across the whole fleet.

## Conventions & guardrails for development

- Build the core first (double-entry ledger + OCC overspend prevention on **GA** DSQL features);
  preview features (CDC, AgentCore) are layered and degradable.
- Prove the overspend invariant with a concurrency test.
- Keep the agent side minimal; a mockable x402/AgentCore adapter is enough. The ledger is the star.
- Keep every transaction well under the 3,000-row cap; avoid unsupported PG features.
- Never depend on preview APIs or mainnet funds for core functionality.
- Write clean, self-explanatory code with no comments by default. Imports use the `@/*` alias
  (tsconfig root); no `../../`.

## Product surfaces

- **Budget & policy:** hierarchy + inheritance (org→team→agent→session), soft/hard caps, threshold
  alerts (50/80/100%), time windows, vendor allow/blocklists, human-in-the-loop approval over $X,
  global + per-agent kill-switch, rate limiting.
- **Audit-grade trust:** tamper-evident hash-chained entries, full JSON receipt capture, export to
  accounting (CSV/QuickBooks/NetSuite), idempotency keys (no double-charge).
- **Attribution:** cost attribution to teams/customers/features, usage-based billing, chargeback/
  showback, multi-provider cost normalization.
- **Spend safety:** anomaly/circuit-breaker, spend-velocity auto-freeze, forecasting/projected burn,
  sandbox/test mode.
- **Integration:** 3-line SDK, x402/AgentCore/Stripe/AP2 adapters, NL-query server, Slack/email/
  webhook alerts, agent identity + scoped API keys, RBAC, multi-tenancy.

## Repo layout

- `core/`: **pure, dependency-free domain**. `ledger.ts` (store-agnostic `spend()` + `runOcc`/
  `buildEntry` helpers + the hierarchy walk + velocity breaker), `settlement.ts` (reserve/settle/
  release, exactly-once), `payment.ts` (gateway interface + counting mock), `harness.ts` (naive-vs-
  Stub exactly-once proof), `store.ts` (`Store`/`Tx` interface), `mem-store.ts` (in-memory OCC model
  for offline tests), `policy.ts`, `query.ts`, `audit.ts`, `hash.ts`, `burn.ts`, `forecast.ts`,
  `apikey.ts`. No `pg`/AWS imports here.
- `db/`: the **Aurora DSQL adapter**. `client.ts` (`createPool`/`getPool`), `pg-store.ts` (`Store`
  impl over DSQL), `schema.sql` (single source of truth, idempotent; secondary indexes use
  `CREATE INDEX ASYNC`; applied by `npm run migrate`). Swap this dir, the core is untouched.
- `sdk/`: the **drop-in SDK** (`index.ts` `StubClient` with `guard`/`spend`/`reserve`/`settle`/
  `release`) + thin mockable x402/AgentCore adapter (`x402.ts` `payThroughStub`, reserve→pay→settle).
  Dependency-free; **published to npm as `trystub`** (own `package.json`/`tsconfig.json`, built
  to `dist/`, shipped by the `Publish SDK` workflow on a `sdk-v*` tag).
- `config/`: single source of truth for env-driven values (`index.ts`): `dsql`, `openai`, `app`,
  `demo`, `limits`, plus `requiredEnv` (lazy). `core/` and `sdk/` stay config-free.
- `app/` `components/` `lib/`: Next.js (App Router) multipage console + API routes + server helpers.
  Pages: `/dashboard` (overview), `/incident` (replay), `/settlement` (reserve→pay→settle),
  `/audit` (chain verification + journal export), `/attribution` (chargeback/showback), all sharing
  the `AppTabs` sub-nav. Every route runs through `lib/api.ts` `withRoute` (request id, sanitized
  errors, admin auth, rate limit); page-level gating via `adminPageAllowed`. Auth is open when
  `ADMIN_TOKEN` is unset, enforced when set.
- `scripts/`: operational commands (migrate/seed/seed:activity/check/demo-agent). `test/`:
  invariant + live proofs. `docs/`: local-only planning notes (gitignored).

## Commands

- Dev: `npm run dev` · Build: `npm run build` · Typecheck: `npm run typecheck`
- Lint/format: `npm run lint` · `npm run format` · `npm run verify` (lint + typecheck + invariant).
  Husky hooks run lint-staged on pre-commit and commitlint on commit-msg (Conventional Commits).
- DB: `npm run check:db` · `npm run migrate` · `npm run seed` · `npm run seed:activity`
- Demo agent (needs `npm run dev`): `npm run demo:agent`
- Offline invariant gate (in-memory OCC, no cluster): `npm test` / `npm run test:invariant`
- **Exactly-once harness** (naive double-pay vs Stub, prints pass/fail): `npm run harness`
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
