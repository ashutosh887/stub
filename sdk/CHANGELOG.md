# Changelog

What changes for someone using `trystub`, or running the Stub server it talks to. Console styling,
marketing pages, docs, and internal refactors are deliberately not listed here.

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) versions. Each released section below is
published verbatim as the body of the matching
[GitHub Release](https://github.com/ashutosh887/stub/releases).

## [Unreleased]

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

[unreleased]: https://github.com/ashutosh887/stub/compare/sdk-v1.1.0...HEAD
[1.1.0]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.2...sdk-v1.1.0
[1.0.2]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.1...sdk-v1.0.2
[1.0.1]: https://github.com/ashutosh887/stub/compare/sdk-v1.0.0...sdk-v1.0.1
[1.0.0]: https://github.com/ashutosh887/stub/releases/tag/sdk-v1.0.0
