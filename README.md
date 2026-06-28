# Stub

**The spend control plane for AI agents.**

_One budget your agents can't break._

---

## What is Stub?

Stub is a strongly-consistent, double-entry **spend ledger + policy gate** that sits between an
organization's fleet of autonomous AI agents and the money they spend — x402 micropayments, paid
APIs, and LLM tokens. It enforces one company-wide budget that **cannot be overspent** and produces
an immutable, queryable audit trail.

Think **Ramp / Brex for the agent economy**: as agents move from reading to *spending* real money,
every company running them needs org-wide budget enforcement and audit-grade books.

## The problem

AWS Bedrock AgentCore Payments gives agents wallets — but spending limits are enforced **per
session only**. There's no org-wide, cross-agent, cross-region budget governance and no audit-grade
ledger. So a fleet can quietly overspend overnight, and no one can answer the CFO's two questions:
**how much did our agents spend, and on exactly what?**

That gap is Stub.

## How it works

> A spend that would breach a budget cap **fails the database transaction.** Under concurrent
> cross-region agent writes, Aurora DSQL's optimistic concurrency control returns a serialization
> failure (`SQLSTATE 40001`); Stub retries or denies and records a denial entry. The result is a
> **zero overspend window**, guaranteed by the database — not by application luck.

```
Agent (x402 / AgentCore adapter)
   → Stub API
      → policy check
      → atomic double-entry write under DSQL OCC  ──(40001)──► retry / deny + denial entry
   → DSQL CDC → Kinesis → live dashboard + anomaly circuit breaker
```

## Stack

| Layer        | Choice                                                          |
| ------------ | -------------------------------------------------------------- |
| Database     | **Amazon Aurora DSQL** (strong consistency + OCC = load-bearing) |
| Frontend     | Next.js + Tailwind, scaffolded in v0.app                       |
| Deploy       | Vercel                                                          |
| Real-time    | Aurora DSQL CDC → Amazon Kinesis → AWS Lambda                  |
| Observability| Amazon CloudWatch + AWS CloudTrail                            |

**Why Aurora DSQL:** budget-enforcement correctness *is* DSQL's strong consistency plus OCC. Swap
the database and the core safety feature breaks — the database is unswappable, by design.

## Data model

A deliberate double-entry ledger:

- **`accounts`** — budget accounts (org → team → agent → vendor), each with a balance, a hard cap,
  and an optional velocity limit. A spend is bound by the **tightest cap up the hierarchy**: it
  debits the named account and rolls up every ancestor's balance in the same transaction, so two
  agents in different teams racing the org budget serialize on the org row.
- **`entries`** — immutable double-entry lines; the append-only audit log. Includes a compressed
  JSON receipt of the full x402 payment context. Balances are derived transactionally.
- **`policies`** — layered ceilings (per-transaction · per-session · per-day · cumulative org-wide),
  evaluated against each spend's intent at runtime; plus time windows and vendor allowlists.
- **`agents` / `sessions`** — identity + scoped API keys (SHA-256 hashed) + session budgets.

## Status

Working on live Aurora DSQL (verified end-to-end 2026-06-27):

- ✅ **Double-entry ledger + overspend invariant** — proven on the live multi-region cluster: concurrent
  cross-region writes that would breach a cap fail with `SQLSTATE 40001` and are logged as denials;
  the balance never goes negative.
- ✅ **Budget hierarchy + inheritance** — org → team → agent caps enforced together; a spend rolls up
  every ancestor balance in one transaction, so the org-wide budget can't be breached across teams.
- ✅ **Tamper-evident hash chain** + idempotency keys.
- ✅ **Policy engine** — per-transaction caps, rolling-window ceilings, vendor allow/blocklists,
  approval thresholds — evaluated inside the spend transaction. Plus a **policy simulator** (replays
  history against a candidate rule) and a **kill-switch / freeze**.
- ✅ **Velocity circuit-breaker** — runaway spend trips a per-account velocity limit and **auto-freezes**
  the account (app-layer fallback for the CDC anomaly breaker).
- ✅ **Agent registry + scoped API keys** — "know your agent": issue a key bound to one budget account;
  spends made with it are pinned to that agent and attributed.
- ✅ **3-line SDK + x402 / AgentCore adapter** — drop the gate in front of any paid call; the spend
  clears the budget before any money moves. `npm run demo:agent` drives it end-to-end.
- ✅ **Soft caps + burn alerts** (50 / 80 / 100%) and **forecasting** ("runway" — when the budget runs out).
- ✅ **Mission-control dashboard** — org guardrail, accounts with burn bars, agent registry, live ledger +
  denial feeds, spend simulator, with live polling.
- ✅ **Natural-language query** — ask about spend in plain English (OpenAI, with a deterministic
  offline parser fallback); the model fills a constrained query, never raw SQL.

Remaining: Vercel deploy, CDC→Kinesis live feed, and submission artifacts (video, diagram).

## Running locally

```bash
npm install
cp .env.example .env        # fill in DSQL_* (and optionally OPENAI_API_KEY)
npm run check:db            # verify the DSQL connection
npm run migrate && npm run seed
npm run dev                 # dashboard at http://localhost:3000
npm run demo:agent          # an agent spending through the gate (needs `npm run dev` running)

npm test                    # offline invariant gate (48 tests)
npm run test:live           # live cross-region overspend proof (needs DSQL_ENDPOINT_PEER)
```

### 3-line SDK

```ts
import { StubClient } from "./sdk";
const stub = new StubClient({ apiKey: process.env.STUB_API_KEY });
if (await stub.guard({ vendorAccountId, amountUsd: 0.02, intent: "fetch data" })) {
  await doThePaidThing(); // only runs if the budget gate committed the spend
}
```

See [`TODO.md`](./TODO.md) for the phased plan and [`CLAUDE.md`](./CLAUDE.md) for architecture notes.

Built for the **H0: Hack the Zero Stack** hackathon (Vercel v0 + AWS Databases) — Track 2,
Monetizable B2B.
