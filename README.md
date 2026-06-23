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

- **`accounts`** — budget accounts (org, team, agent, vendor), each with a balance
- **`entries`** — immutable double-entry lines; the append-only audit log. Includes a compressed
  JSON receipt of the full x402 payment context. Balances are derived transactionally.
- **`policies`** — caps, time windows, vendor allowlists
- **`agents` / `sessions`** — identity + session budgets

## Status

🚧 Early development. See [`TODO.md`](./TODO.md) for the phased build plan and
[`CLAUDE.md`](./CLAUDE.md) for full architecture and engineering notes.

Built for the **H0: Hack the Zero Stack** hackathon (Vercel v0 + AWS Databases) — Track 2,
Monetizable B2B.
