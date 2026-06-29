# Stub

**The general ledger for agent spend.**

_One budget your agents can't break._

> Stub is the general ledger for agent spend — the one budget your fleet can't overspend, because
> the database, not your code, rejects the transaction that would.

**Live:** [trystub.vercel.app](https://trystub.vercel.app) · built on Amazon Aurora DSQL + Next.js on Vercel

---

## What is Stub?

Stub is a strongly-consistent, double-entry **spend ledger** for an organization's fleet of
autonomous AI agents and the money they spend — x402 micropayments, paid APIs, and LLM tokens. It
enforces one company-wide budget that **cannot be overspent** and produces an immutable, queryable
audit trail. The gate that refuses an overspend is one feature of the ledger — not the product.

Think **Ramp / Brex for the agent economy**: as agents move from reading to *spending* real money,
every company running them needs org-wide budget enforcement and audit-grade books.

## The problem

Agent payment frameworks (e.g. AWS Bedrock AgentCore Payments) give agents wallets, but spending
limits are enforced **per session only**. There is no org-wide, cross-agent, cross-region budget
governance and no audit-grade ledger. A fleet can quietly overspend overnight — every session
within its own limit — and afterward no one can answer the CFO's two questions: **how much did our
agents spend, and on exactly what?**

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

```
Agent (x402 / AgentCore)
  → 3-line SDK ─ guard()
  → Stub API (Next.js route: auth · rate-limit · request id)
      → policy + hierarchy + velocity check
      → atomic double-entry write under Aurora DSQL OCC ──(40001)──► retry / deny + denial entry
  → immutable, hash-chained ledger
      → mission-control dashboard (live) · natural-language query
```

## Why Aurora DSQL

Budget-enforcement correctness *is* the database's consistency model. The load-bearing property is
**active-active, multi-region strong consistency** — a writer in `us-east-1` and a writer in
`us-east-2` hitting the same balance resolve to one consistent outcome. No other AWS database
offers it: Aurora PostgreSQL Global is single-writer, and DynamoDB global tables are eventually
consistent (last-writer-wins → silent overspend during replication). Swap the database and the core
safety feature breaks.

## Architecture

| Layer       | Choice                                                              |
| ----------- | ------------------------------------------------------------------ |
| Database    | **Amazon Aurora DSQL** — strong consistency + OCC (load-bearing)   |
| Driver      | `pg` over the Aurora DSQL Node connector (automatic IAM tokens)    |
| API         | Next.js App Router route handlers (Node runtime)                   |
| Frontend    | Next.js + Tailwind                                                 |
| Deploy      | Vercel                                                             |
| NL query    | OpenAI function-calling, with a deterministic offline parser fallback |

The codebase keeps the domain pure and the database swappable:

```
core/   pure, dependency-free domain — ledger, policy, hash chain, query, forecast, API keys
db/     the Aurora DSQL adapter — connection pool, Store implementation, schema.sql
sdk/    the 3-line drop-in client + x402 / AgentCore adapter
app/    Next.js dashboard + API routes      lib/  server helpers (auth, rate limit, data)
config/ single source of truth for env      scripts/  migrate · seed · check · demo-agent
test/   invariant suite + live cross-region proof
```

## Data model

A deliberate double-entry ledger:

- **`accounts`** — budget accounts (org → team → agent → vendor), each with a balance, a hard cap,
  and an optional velocity limit. A spend is bound by the **tightest cap up the hierarchy**: it
  debits the named account and rolls up every ancestor's balance in the same transaction.
- **`entries`** — immutable double-entry lines; the append-only audit log. Each carries a compressed
  JSON receipt of the full payment context and is **hash-chained** (`prev_hash → hash`) so any
  altered or removed row is detectable. Every line is attributed to a user, intent, agent, and session.
- **`policies`** — layered ceilings (per-transaction · rolling window · cumulative), evaluated against
  each spend at runtime, plus vendor allow/blocklists and approval thresholds.
- **`agents` / `sessions`** — identity, session budgets, and scoped API keys (SHA-256 hashed).

## Features

- **Overspend invariant** — concurrent cross-region writes that would breach a cap fail with
  `SQLSTATE 40001` and are recorded as denials; the balance never goes negative.
- **Hierarchical budgets** — org → team → agent caps enforced together in one transaction.
- **Policy engine** — per-transaction caps, rolling-window ceilings, vendor allow/blocklists, and
  human-in-the-loop approval thresholds, evaluated inside the spend transaction.
- **Policy simulator** — replay the immutable history against a candidate rule ("this would have
  blocked 7 spends and saved $340") before enabling it.
- **Velocity circuit-breaker** — runaway spend trips a per-account velocity limit and auto-freezes
  the account.
- **Kill-switch** — freeze a single agent or the entire fleet instantly.
- **Tamper-evident audit trail** — hash-chained entries, full JSON receipt capture, and idempotency
  keys (no double-charge).
- **Agent registry + scoped API keys** — issue a key bound to one budget account; spends made with
  it are pinned to that agent and attributed.
- **Burn alerts + forecasting** — 50 / 80 / 100% thresholds and projected runway until a cap is hit.
- **3-line SDK** — drop the budget gate in front of any paid call; money moves only after the spend
  commits.
- **Mission-control dashboard** — org guardrail, accounts with burn bars, the agent registry, and
  live ledger + denial feeds.
- **Natural-language query** — ask about spend in plain English; the model fills a constrained,
  parameterized query over the ledger, never raw SQL.

## Quickstart

```bash
npm install
cp .env.example .env        # set DSQL_* (and optionally OPENAI_API_KEY)
npm run check:db            # verify the Aurora DSQL connection
npm run migrate && npm run seed
npm run dev                 # dashboard at http://localhost:3000
npm run demo:agent          # an agent spending through the gate (needs the dev server running)
```

Tests:

```bash
npm test                    # offline invariant suite (in-memory OCC model, no cluster needed)
npm run test:live           # live cross-region overspend proof (requires DSQL_ENDPOINT_PEER)
```

## SDK

```ts
import { StubClient } from "./sdk";

const stub = new StubClient({ apiKey: process.env.STUB_API_KEY });

if (await stub.guard({ vendorAccountId, amountUsd: 0.02, intent: "fetch market data" })) {
  await doThePaidThing(); // runs only if the budget gate committed the spend
}
```

## Deployment

See [`DEPLOY.md`](./DEPLOY.md) for deploying to Vercel against a live Aurora DSQL cluster.
