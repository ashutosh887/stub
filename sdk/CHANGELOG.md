# Changelog

What changes for someone using `trystub`, or running the Stub server it talks to. Console styling,
marketing pages, docs, and internal refactors are deliberately not listed here.

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) versions. Each released section below is
published verbatim as the body of the matching
[GitHub Release](https://github.com/ashutosh887/stub/releases).

## [Unreleased]

### Changed

- **Stub server: admin routes fail closed in production.** With `ADMIN_TOKEN` unset, a production
  deployment now answers admin routes with `401` instead of letting every caller through. Set
  `ADMIN_TOKEN` before upgrading a production server.
- **Stub server: the database refuses a negative balance.** Balances carry
  `CHECK (balance_micro >= 0)`; run `npm run migrate` to add it.
- **Stub server: the app connects as `stub_app` by default.** It needs the role from
  `npm run db:app-role`; set `DSQL_USER=admin` to keep the old behaviour. On Vercel, set
  `AWS_ROLE_ARN` to sign with OIDC credentials. `/api/stress` and `/api/incident` answer `403` on
  the app role.

### Added

- **Stub server: automatic failover to the peer Region.** With `DSQL_ENDPOINT_PEER` set, a server
  that cannot reach its primary DSQL endpoint serves the call from the peer and returns to the
  primary once it answers again (`DSQL_FAILOVER=off` turns it off). `GET /api/health` now includes
  the active `region`.

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
  ancestor hierarchy caps entirely — only the shard-level cap was enforced. Fixed to match the
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

[unreleased]: https://github.com/ashutosh887/stub/compare/sdk-v1.2.0...HEAD
[1.2.0]: https://github.com/ashutosh887/stub/compare/sdk-v1.1.0...sdk-v1.2.0
[1.1.0]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.2...sdk-v1.1.0
[1.0.2]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.1...sdk-v1.0.2
[1.0.1]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.0...sdk-v1.0.1
[1.0.0]: https://github.com/ashutosh887/stub/releases/tag/sdk-v1.0.0
