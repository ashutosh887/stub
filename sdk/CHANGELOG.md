# Changelog

What changes for someone using `trystub`, or running the Stub server it talks to. Console styling,
marketing pages, docs, and internal refactors are deliberately not listed here.

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) versions. Each released section below is
published verbatim as the body of the matching
[GitHub Release](https://github.com/ashutosh887/stub/releases).

## [Unreleased]

## [2.0.1] - 2026-11-27

No code change: `dist` is byte-identical to 2.0.0.

### Changed

- The npm description, keywords and README now say the server's database refuses the overspend,
  and link the live proof.

## [2.0.0] - 2026-11-27

The database now enforces the budget. Before this release the overspend check lived in the server's
code, so any path that skipped it could overdraw a budget: ten writers took a $3.00 budget to
-$7.00 on Aurora DSQL. Now the same race stops at $0.00, and the database refuses the other seven
writes with `23514`. The SDK's method signatures are unchanged. It is a major version because four
server changes can break an existing caller or deployment; they are listed first.

### Breaking

- **Payees must be vendor accounts.** A spend or reserve whose vendor is unknown, is not a vendor
  account, or is the budget itself is denied with `unknown_vendor`, `payee_not_vendor` or
  `payee_is_budget`. Before, an agent could name its own account as the vendor and raise its own
  balance.
- **Stub server: admin routes fail closed in production.** With `ADMIN_TOKEN` unset, a production
  deployment answers admin routes with `401` instead of letting every caller through. The ledger
  exports (`/api/export`, `/api/export/journal`) and `/api/audit/verify` are admin routes now too.
  Set `ADMIN_TOKEN` before upgrading a production server.
- **Stub server: the app connects as `stub_app` by default.** The role from `npm run db:app-role`
  cannot update or delete a ledger entry, create an account or change the schema. Set
  `DSQL_USER=admin` to keep the old behaviour. On Vercel, set `AWS_ROLE_ARN` to sign with
  short-lived OIDC credentials instead of a stored key.
- **Stub server: drills run as `stub_app`.** `/api/stress` and `/api/incident` hold and release
  against fixed drill budgets instead of creating and deleting accounts, so they work on the
  least-privilege role and put every balance back where it started. Their holds and
  denials stay on record. Run `npm run seed:drills` once as
  `admin` to create them.

### Changed

- **Stub server: the database refuses a balance below zero or above its cap.** Balances carry
  `CHECK (balance_micro >= 0)`, and capped accounts
  `CHECK (cap_micro IS NULL OR balance_micro <= cap_micro)`. A write that breaks either fails with
  `23514`, whoever sends it. Run `npm run migrate` to add them; on Aurora DSQL it adds each one
  `NOT VALID` and validates it with `ALTER TABLE ASYNC`.
- **Stub server: a write the database refuses is a denial, not a `500`.** When a balance `CHECK`
  fails with `23514` after the server's own budget check passed, `spend()` and `reserve()` come back
  `denied` with reason `db_refused`, and the denial is recorded like any other. Nothing is retried
  and no balance moves. `settle()` and `release()` come back `invalid` with the same reason and the
  hold stays in place.

### Added

- **Stub server: automatic failover to the peer Region.** With `DSQL_ENDPOINT_PEER` set, a server
  that cannot reach its primary DSQL endpoint serves the call from the peer and returns to the
  primary once it answers again (`DSQL_FAILOVER=off` turns it off). `GET /api/health` now includes
  the active `region`.
- **`npm run race:bypass`.** Races writers that skip the server's check against one budget and
  reports what the database committed and refused. CI runs it, and every `/proof` statement, as
  `stub_app` on Postgres 17.

### Fixed

- **`settle()` and `release()` no longer answer `500`.** The routes returned `bigint` amounts that
  JSON cannot serialize, so the settle committed but the response failed and the SDK's retry came
  back `duplicate`. Amounts are now strings, which the SDK's types already allowed.
- **Reserving on a sharded account holds the money in its shards.** Before, a hold debited the
  account row the shards no longer use, so a hold and a sharded spend could both use the same money.
  `provisionShards` now refuses an account that has child accounts.
- **Postgres deadlocks are retried.** Concurrent sharded spends on plain Postgres could fail with
  `40P01`; the store now retries it like a `40001`.
- **`next build` needs no database variable.** The store opens its pool on first use.

## [1.2.0] - 2026-08-10

### Added

- **Operator actions on `StubClient`.** `stub.sweep()` reclaims reservations left held past the
  server's `RESERVATION_TTL_SECONDS`; `stub.provisionShards(accountId, shards?)` splits an
  account's current balance across shard rows for throughput. Both are operator-only: construct
  the client with the server's `ADMIN_TOKEN` as `apiKey`, not an agent's scoped key.
- **Stub server: reservation TTL sweep.** A held reservation nobody ever settles or releases
  (a crashed agent) is reclaimed automatically past `RESERVATION_TTL_SECONDS` (default 900s), via
  `npm run sweep` or the new admin-gated `POST /api/sweep`. Idempotent: contends on the reservation
  row under OCC exactly like a normal `release()`, so it can never double-refund a hold another
  process is settling.

### Fixed

- **Stub server: sharded accounts now enforce the same policy as everyone else.** A sharded budget
  account previously skipped the frozen check, the policy engine, the velocity breaker, and
  ancestor hierarchy caps entirely. Only the shard-level cap was enforced. Fixed to match the
  plain spend path exactly; `/api/spend` now dispatches to the sharded path automatically for any
  account provisioned with `provisionShards`.

## [1.1.0] - 2026-07-31

### Added

- **LLM token metering.** New `trystub/llm` entry point: `meterLLM`, `usageFrom`, `costUsd`,
  `estimateUsd`. Hold an estimate, run the call once, settle the real token cost. Reads the OpenAI
  and Anthropic usage shapes. Ships no model price table on purpose, since a stale price inside a
  dependency quietly mis-bills you; the caller supplies the rates.
- **Retries that cannot double-charge.** Per-call timeout, bounded retries on network errors, `429`
  and `5xx`, and a generated idempotency key on every `spend` and `reserve`. A request retried after
  the server already committed resolves to the same single ledger entry.
- **Stub server: sharded balances.** `shardedSpend` splits a hot balance across shard rows for 1.2x
  to 2.8x throughput under contention. No shard can go below zero, so the overspend invariant still
  holds. Opt-in. `npm run bench` measures the ceiling.
- **Stub server: local Postgres driver.** Set `DATABASE_URL` and Stub runs with no AWS account.
  Transactions open `SERIALIZABLE`, so plain Postgres raises the same `40001` serialization failures
  as Aurora DSQL. `npm run test:local` proves the invariant offline.

### Changed

- **Dual ESM and CommonJS build.** `require("trystub")` works now. Previously ESM only.

## [1.0.2] - 2026-07-05

Discoverability release. No API changes.

### Added

- `bugs` URL and `publishConfig.access` in `package.json`.
- Status badges and a link to the build story in the README.

### Changed

- Expanded npm keywords from 8 to 19 for better search ranking.

## [1.0.1] - 2026-06-29

Documentation release. No API changes.

### Changed

- README now leads with the tagline and clearer usage.

## [1.0.0] - 2026-06-29

First public release: a drop-in budget gate for autonomous AI agents.

### Added

- `StubClient` with `guard`, `spend`, `reserve`, `settle`, and `release`.
- `payThroughStub` (x402 adapter): reserve, pay once, settle. Exactly-once around an irreversible
  payment.
- Dependency-free. Works anywhere `fetch` exists.

[unreleased]: https://github.com/ashutosh887/stub/compare/sdk-v1.3.0...HEAD
[1.3.0]: https://github.com/ashutosh887/stub/compare/sdk-v1.2.0...sdk-v1.3.0
[1.2.0]: https://github.com/ashutosh887/stub/compare/sdk-v1.1.0...sdk-v1.2.0
[1.1.0]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.2...sdk-v1.1.0
[1.0.2]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.1...sdk-v1.0.2
[1.0.1]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.0...sdk-v1.0.1
[1.0.0]: https://github.com/ashutosh887/stub/releases/tag/sdk-v1.0.0
