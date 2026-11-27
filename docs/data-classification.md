# Data classification

Every piece of data Stub stores or emits, its class, how long it is kept and where it flows. The
operator owns all of it. Columns are from `db/schema.sql`.

## Classes

| Class            | Meaning                                                                                           | Handling                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Public**       | Meant for anyone; publishing it harms nobody.                                                     | No access control needed.                                                                                                         |
| **Internal**     | Identifiers and settings that describe how Stub is set up; harmless alone, useful to an attacker. | Admin-only routes, the app's database role, TLS in transit, encrypted at rest.                                                    |
| **Confidential** | Money, spend history, who spent it and on what, credentials and their hashes, security logs.      | Admin-only routes or the agent's own key, never in logs, never in a public page, encrypted at rest, exports only to the operator. |

Credentials (the `ADMIN_TOKEN`, agent API keys in plaintext, AWS credentials) are never stored by
Stub: the admin token lives in the hosting environment, an agent key is shown once at creation and
only its SHA-256 is stored, and AWS access comes from short-lived role credentials.

## Ledger database (Aurora DSQL)

Encrypted at rest by DSQL, TLS in transit, reachable only by the `stub-app` role (as `stub_app`) and
the operators (cluster policy, `infra/stub-clusters.yaml`). Replicated synchronously to the peer
Region.

| Table              | Columns                                                                                                            | Class        | Retention                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------- |
| `accounts`         | `balance_micro`, `cap_micro`, `velocity_limit_micro`                                                               | Confidential | Life of the ledger                                                                  |
| `accounts`         | `id`, `type`, `parent_id`, `name`, `frozen`, `velocity_window_seconds`, `sharded`, `last_entry_hash`, `created_at` | Internal     | Life of the ledger                                                                  |
| `entries`          | every column; `user_id`, `intent`, `receipt` can identify a person or a deal                                       | Confidential | Forever: append-only, the app role has no `UPDATE` or `DELETE`                      |
| `denials`          | every column (`attempted_micro`, `reason`, `agent_id`, `session_id`, `intent`, `cost_center`, `receipt`)           | Confidential | Forever: the app role has no `UPDATE` or `DELETE`                                   |
| `reservations`     | every column (`held_micro`, `settled_micro`, `user_id`, `intent`, `receipt`, …)                                    | Confidential | Kept after settle or release; the app role may set the status, never delete         |
| `account_shards`   | `balance_micro`                                                                                                    | Confidential | Life of the sharded account                                                         |
| `account_shards`   | `account_id`, `shard_index`, `last_entry_hash`, `created_at`                                                       | Internal     | Life of the sharded account                                                         |
| `policies`         | `limit_micro`, `approval_threshold_micro`, `vendor_allow`, `vendor_block`                                          | Confidential | Until the operator deletes the policy (the one table the app role may delete from)  |
| `policies`         | `id`, `account_id`, `label`, `enabled`, `scope`, `window_seconds`, `created_at`                                    | Internal     | Until deleted                                                                       |
| `agents`           | `api_key_hash`                                                                                                     | Confidential | Life of the agent                                                                   |
| `agents`           | `id`, `account_id`, `name`, `api_key_preview`, `created_at`                                                        | Internal     | Life of the agent                                                                   |
| `sessions`         | `budget_micro`                                                                                                     | Confidential | The app role has no grant on this table                                             |
| `sessions`         | `id`, `agent_id`, `account_id`, `created_at`                                                                       | Internal     | As above                                                                            |
| `idempotency_keys` | every column                                                                                                       | Internal     | No expiry; the app role cannot delete, an operator prunes it                        |
| `query_cache`      | `question`, `payload` (answers built from ledger totals)                                                           | Confidential | No expiry; a new spend changes the key, old rows stay until an operator prunes them |
| `query_cache`      | `cache_key`, `created_at`                                                                                          | Internal     | As above                                                                            |
| `proof_runs`       | every column (`ran_at`, `region`, `statements`, `refused`, `accepted`); no IP, no visitor identifier               | Public       | No expiry; the app role may only insert and read, an operator prunes it             |

## Exports and API responses

| Output                                                                                | Class        | Who can get it                | Contents                                                                                |
| ------------------------------------------------------------------------------------- | ------------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/export` (`stub-ledger.csv`)                                                 | Confidential | Admin token                   | Up to 5,000 entries: time, transaction, account, kind, amount, agent, intent, hashes    |
| `GET /api/export/journal` (`stub-journal.csv`)                                        | Confidential | Admin token                   | Up to 5,000 journal lines: date, transaction, account, cost center, debit, credit, memo |
| `GET /api/ledger`, `/api/accounts`, `/api/policies`, `/api/agents`, `POST /api/query` | Confidential | Admin token                   | Ledger rows, balances, policies, agents, answers                                        |
| `GET /api/audit/verify`                                                               | Internal     | Admin token                   | Account names and ids, entry counts, chain heads, chain problems                        |
| `POST /api/spend`, `/reserve`, `/settle`, `/release` responses                        | Confidential | The agent's own key, or admin | That one transaction's outcome                                                          |
| `POST /api/proof`                                                                     | Public       | Anyone                        | SQLSTATE per probe statement, the Region label; every statement rolls back              |
| `GET /api/proof`                                                                      | Public       | Anyone                        | Visitor run count since the first run, statements refused and accepted                  |
| `GET /api/health`                                                                     | Public       | Anyone                        | Up or down, active Region, latency                                                      |
| `measurements/wa-review/RESULTS.md`, `/proof`                                         | Public       | Anyone                        | Measured counts and timings; no identifiers                                             |

A downloaded export is Confidential wherever it lands: keep it out of tickets, chat and shared
drives, and delete it when the reconciliation it was for is done.

## Logs, backups and copies

| Data                                                                                              | Class        | Where                                                                                                           | Retention                                                                       |
| ------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| App logs (`request`, `spend_settled`, `occ_exhausted`, `unauthorized`, `dsql_endpoint_switch`, …) | Internal     | Vercel runtime logs (stdout and stderr)                                                                         | Vercel's runtime log retention for the plan                                     |
| Redaction in app logs                                                                             | n/a          | `lib/log.ts` masks any `authorization`, `api_key`, `token`, `password`, `secret` field and any `stub_sk_` value | n/a                                                                             |
| CloudTrail logs and digests (who called which AWS API, from where)                                | Confidential | S3 log bucket from `infra/stub-audit.yaml`, SSE-S3, TLS only, no deletes by any principal                       | Glacier Instant Retrieval at 90 days, expired at 365 days; old versions 30 days |
| AWS Config snapshots (DSQL cluster settings)                                                      | Internal     | Same bucket, `Config/` prefix                                                                                   | Same lifecycle                                                                  |
| DSQL SQL audit log (DDL, role changes and writes, with the statement and the IAM identity)        | Confidential | Per-Region S3 bucket from `infra/stub-clusters.yaml`, Object Lock (governance), deletes denied                  | Locked, then expired, after the template's `AuditLogRetentionDays`              |
| AWS Backup recovery points (the whole ledger)                                                     | Confidential | Vault `stub-ledger` in both Regions, Vault Lock (governance)                                                    | 35 days, no deletion before 7                                                   |
| GuardDuty findings                                                                                | Confidential | GuardDuty in each Region; severity 4+ to the ops topic                                                          | GuardDuty's 90 days                                                             |
| Ops alerts                                                                                        | Internal     | SNS `wa-stub-ops-alerts` (KMS customer managed key) to the operator's subscription                              | Not stored by SNS                                                               |

## Where Confidential data flows outside the ledger

- **OpenAI** (only when `OPENAI_API_KEY` is set): `POST /api/query` sends the operator's question,
  then the aggregated result rows (account, agent, vendor or cost-center names with totals and
  counts) so the model can phrase the answer. No raw entries, receipts or keys are sent. Without
  the key the deterministic parser answers and nothing leaves.
- **Vercel**: hosts the app; ledger data passes through its functions in memory and only the
  Internal log lines above are written.
- **The operator's machine**: CSV exports and the `ledger:fingerprint` script's output.

Nothing else leaves: the SDK talks only to the Stub deployment it is pointed at. No route deletes
ledger rows. The drills (`/api/stress`, `/api/incident`) run against their own accounts
(`drill-*`, from `npm run seed:drills`). They place holds and release them, so they add only
reservations and denials, and the dashboard and query box leave those accounts out.
