# Well-Architected fix: the database enforces the budget

Finding F01 of the Well-Architected review (Security and Reliability pillars, 26 Nov 2026):
SEC03-BP01, "Each of your workload components or services runs under a distinct identity scoped to
the permissions its function requires." Before this change the overspend check lived only in app
code (`core/ledger.ts`), the app connected to Aurora DSQL as `admin`, and the only principal allowed
to connect was a shared IAM user with AdministratorAccess and a long-lived key. Also covered: F02
(admin routes open when `ADMIN_TOKEN` is unset) and the deletion-protection half of F03.

Account IDs, cluster IDs, the Vercel team slug and IAM user names are left out on purpose; the
commands read them from the environment.

## Before and after

| Measure                                                                                                       | Before                                             | After                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| App's AWS principal: destructive DSQL actions allowed (3 actions × 2 clusters)                                | 6 of 6 (shared IAM user)                           | 0 of 6 (`stub-app` role)                                                                          |
| App's AWS principal: `dsql:DbConnect` on both clusters                                                        | 2 of 2                                             | 2 of 2                                                                                            |
| Other actions on the app role (CreateCluster, Put/DeleteClusterPolicy, PassRole, CreateAccessKey, AssumeRole) | not simulated (the user holds AdministratorAccess) | 0 of 6                                                                                            |
| App's credentials                                                                                             | long-lived access key                              | Vercel OIDC, 1-hour sessions, trusted only for `owner:<team>:project:stub:environment:production` |
| App's database role                                                                                           | `admin` (owns every table)                         | `stub_app` (no ownership, column-level UPDATE)                                                    |
| Balance below zero, as the app's DB role                                                                      | accepted                                           | refused, `23514 accounts_balance_nonnegative`                                                     |
| Balance below zero, as `admin`                                                                                | accepted                                           | refused, `23514`                                                                                  |
| Rewrite an `entries` row, as the app's DB role                                                                | accepted                                           | refused, `42501 permission denied for table entries`                                              |
| Delete an `entries` row, as the app's DB role                                                                 | accepted                                           | refused, `42501`                                                                                  |
| Create an account, as the app's DB role                                                                       | accepted                                           | refused, `42501`                                                                                  |
| CREATE TABLE, as the app's DB role                                                                            | allowed (owner)                                    | refused, `42501 permission denied for schema public`                                              |
| DROP TABLE entries, as the app's DB role                                                                      | allowed (owner)                                    | refused, `42501 must be owner of table entries`                                                   |
| CHECK constraints on balance tables                                                                           | 0                                                  | 2, both `convalidated = true`                                                                     |
| Deletion protection                                                                                           | 0 of 2 clusters                                    | 2 of 2                                                                                            |
| Admin routes in production with `ADMIN_TOKEN` unset                                                           | open to anyone                                     | 401 (in code on this branch; not deployed)                                                        |
| SEC03-BP01 guardrail test                                                                                     | 0 of 3 pass on `main`                              | 3 of 3 pass on this branch                                                                        |

What still passes, by design: `stub_app` can raise a balance (`UPDATE accounts SET balance_micro`),
because every spend, settle and release writes that column. The CHECK bounds it from below only.
Closing that needs balance changes to go through a function the role may execute, which DSQL
supports (`GRANT … ON ROUTINE`) but this change does not attempt.

## 1. Before

### 1a. IAM simulation of the app's principal

`iam:SimulatePrincipalPolicy`, PolicySourceArn = the shared IAM user, both cluster ARNs, run through
the AWS MCP server on 26 Nov 2026 about 09:08 UTC:

| Action                | us-east-1 | us-east-2 |
| --------------------- | --------- | --------- |
| `dsql:DbConnectAdmin` | allowed   | allowed   |
| `dsql:DeleteCluster`  | allowed   | allowed   |
| `dsql:UpdateCluster`  | allowed   | allowed   |
| `dsql:DbConnect`      | allowed   | allowed   |

`dsql:GetCluster`: `deletionProtectionEnabled = false` on both. `iam:ListOpenIDConnectProviders`: 0.

### 1b. What the database accepts from the app's connection

`npx tsx scripts/wa-probe.ts` with `DSQL_USER=admin` (as the app ran), 09:10:24 UTC. Every probe
runs in its own `BEGIN … ROLLBACK`; row counts and the balance total were read again afterwards and
had not moved (30 entries, 2 denials, total balance 1,101.76 USD).

```
{"user":"admin","ownsEntries":true}
{"probe":"drive a budget balance below zero","result":"accepted","rows":1}
{"probe":"raise a budget balance by $1,000","result":"accepted","rows":1}
{"probe":"rewrite an entries row","result":"accepted","rows":1}
{"probe":"delete an entries row","result":"accepted","rows":1}
{"probe":"create an account","result":"accepted","rows":1}
{"probe":"create a table","result":"skipped","message":"role owns the tables"}
{"probe":"drop the entries table","result":"skipped","message":"role owns the tables"}
```

The DDL probes are skipped for a role that owns the tables, so the probe never drops a live table.

### 1c. Live cross-region proof

`npm run test:live` failed before any change: `error: column "sharded" does not exist`. The live
schema had never received `accounts.sharded`, `entries.shard_index` or `account_shards`, because
`npm run migrate` stops at `ALTER TABLE accounts ADD COLUMN … sharded BOOLEAN NOT NULL DEFAULT
false`, which DSQL refuses (`0A000 ALTER TABLE ADD COLUMN with constraint not supported`).

## 2. The fix

| Piece                                                                   | Where                                                                                            | State                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `CHECK (balance_micro >= 0)` on `accounts` and `account_shards`         | `db/schema.sql`, `scripts/migrate.ts`                                                            | applied to the live clusters               |
| `stub_app` role and grants                                              | `db/app-role.sql`, `scripts/app-role.ts`                                                         | applied to the live clusters               |
| OIDC provider + `stub-app` IAM role                                     | `infra/stub-app-role.yaml`, CloudFormation stack `stub-app-identity` (termination protection on) | deployed                                   |
| `AWS IAM GRANT stub_app TO stub-app`                                    | `npm run db:app-role -- grant <arn>`                                                             | applied                                    |
| App connects as `stub_app`, OIDC credentials when `AWS_ROLE_ARN` is set | `config/index.ts`, `db/client.ts`                                                                | branch only                                |
| Admin routes closed in production without `ADMIN_TOKEN`                 | `lib/api.ts`                                                                                     | branch only                                |
| Drills refuse on the app role                                           | `app/api/stress`, `app/api/incident`                                                             | branch only                                |
| Deletion protection                                                     | `dsql:UpdateCluster deletionProtectionEnabled=true`                                              | applied to both clusters                   |
| SEC03-BP01 guardrail                                                    | `test/invariant/least-privilege.test.ts`                                                         | branch only (runs in `npm test`, so in CI) |

### The CHECK constraint on DSQL

DSQL refuses `ALTER TABLE … ADD CONSTRAINT … CHECK (…)` (`0A000 unsupported ALTER TABLE ADD
CONSTRAINT statement`, tested inside `BEGIN … ROLLBACK`). Its ALTER TABLE page says a CHECK added
to an existing table must use `NOT VALID`, then `ALTER TABLE ASYNC … VALIDATE CONSTRAINT`, an
asynchronous job that scans the table and marks the constraint valid. `npm run migrate` now does
exactly that: it adds the constraint only when `pg_constraint` lacks it, validates it when
`convalidated` is false, and waits until it is (on Postgres it runs a plain `VALIDATE`). No
table swap was needed. Before applying: `SELECT count(*) FROM accounts WHERE balance_micro < 0`
returned 0 (7 accounts, lowest balance 0.82 USD); `account_shards` did not exist yet. The second
`npm run migrate` was a no-op.

The same run fixed the `sharded` column: `ADD COLUMN IF NOT EXISTS sharded BOOLEAN` followed by
`ALTER COLUMN sharded SET DEFAULT false`. Existing rows read null, which the store already treats
as not sharded.

### The grants, derived from what the routes execute

| Table              | SELECT | INSERT | UPDATE                                              | DELETE                             |
| ------------------ | ------ | ------ | --------------------------------------------------- | ---------------------------------- |
| `accounts`         | yes    | no     | `balance_micro, last_entry_hash, frozen, sharded`   | no                                 |
| `entries`          | yes    | yes    | no                                                  | no                                 |
| `denials`          | yes    | yes    | no                                                  | no                                 |
| `idempotency_keys` | yes    | yes    | no                                                  | no                                 |
| `reservations`     | yes    | yes    | `status, settled_micro, transaction_id, settled_at` | no                                 |
| `account_shards`   | yes    | yes    | `balance_micro, last_entry_hash`                    | no                                 |
| `policies`         | yes    | yes    | `enabled`                                           | yes (admin route deletes a policy) |
| `agents`           | yes    | yes    | no                                                  | no                                 |
| `query_cache`      | yes    | yes    | no                                                  | no                                 |

`sessions` gets nothing: no route reads it. Column-level `GRANT UPDATE (…)` works on DSQL. No
`GRANT USAGE ON SCHEMA public` was needed: PostgreSQL 16 gives PUBLIC usage but not CREATE.

### `/api/stress` and `/api/incident`

Both drills insert two accounts and then `DELETE` their entries, denials and accounts from the
production tables. `stub_app` has neither INSERT on `accounts` nor DELETE on ledger tables, so the
routes now answer 403 unless the app runs on local Postgres or as `admin`. They stay off the
production role; a separate drill cluster (review F06) is the way to bring them back in production.

## 3. After

### 3a. IAM simulation of the `stub-app` role, 09:23:10 UTC

| Action                | us-east-1    | us-east-2    |
| --------------------- | ------------ | ------------ |
| `dsql:DbConnectAdmin` | implicitDeny | implicitDeny |
| `dsql:DeleteCluster`  | implicitDeny | implicitDeny |
| `dsql:UpdateCluster`  | implicitDeny | implicitDeny |
| `dsql:DbConnect`      | allowed      | allowed      |

Also implicitDeny on `*`: `dsql:CreateCluster`, `dsql:PutClusterPolicy`, `dsql:DeleteClusterPolicy`,
`iam:PassRole`, `iam:CreateAccessKey`, `sts:AssumeRole`. Trust policy: only
`sts:AssumeRoleWithWebIdentity` from `oidc.vercel.com/<team>`, with `aud` and `sub` pinned by
`StringEquals` to the team audience and `owner:<team>:project:stub:environment:production`.
`dsql:GetCluster` after `UpdateCluster`: both `ACTIVE`, `deletionProtectionEnabled = true`.

### 3b. What the database accepts from `stub_app`

The `stub-app` role trusts only Vercel, so the probe used a throwaway role `stub-wa-probe`
(inline policy: `dsql:DbConnect` on the two clusters; trust: the operator's IAM user), mapped with
`npm run db:app-role -- grant`, assumed for 15 minutes from a local script, then unmapped
(`AWS IAM REVOKE`, `sys.iam_pg_role_mappings` shows only `stub-app` afterwards) and deleted
(`GetRole` → `NoSuchEntity`). 09:19:53 UTC:

```
{"user":"stub_app","ownsEntries":false}
{"probe":"drive a budget balance below zero","result":"refused","code":"23514","message":"new row for relation \"accounts\" violates check constraint \"accounts_balance_nonnegative\""}
{"probe":"raise a budget balance by $1,000","result":"accepted","rows":1}
{"probe":"rewrite an entries row","result":"refused","code":"42501","message":"permission denied for table entries"}
{"probe":"delete an entries row","result":"refused","code":"42501","message":"permission denied for table entries"}
{"probe":"create an account","result":"refused","code":"42501","message":"permission denied for table accounts"}
{"probe":"create a table","result":"refused","code":"42501","message":"permission denied for schema public"}
{"probe":"drop the entries table","result":"refused","code":"42501","message":"must be owner of table entries"}
```

As `admin`, 09:20:07 UTC: the negative balance is refused with `23514` too; the other probes are
accepted, as expected for the owner.

The grants are enough for the app. Under the same throwaway role, every write path ran inside one
transaction that was rolled back: spend committed, spend refused by a policy (denial row written),
reserve, settle, reserve then release, freeze toggle, policy insert, update and delete, agent
insert, query-cache insert, provisioning 8 shards on two accounts, and a sharded spend: 11 of 11
succeeded. Counts afterwards matched the counts before.

### 3c. Repository checks

| Command                                                                               | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                            | 16 files, 94 tests passed                                                                                                                                              |
| `npm run verify` (lint, typecheck, tests)                                             | passed                                                                                                                                                                 |
| `npm run build`                                                                       | passed                                                                                                                                                                 |
| guardrail test on `main` (temp worktree)                                              | 0 of 3: `expected 'admin' to be 'stub_app'`, `db/app-role.sql` and `infra/stub-app-role.yaml` missing                                                                  |
| guardrail test on this branch                                                         | 3 of 3                                                                                                                                                                 |
| guardrail test with `GRANT UPDATE ON entries` and `Action: dsql:DbConnectAdmin` added | 2 of 3 fail, then restored                                                                                                                                             |
| `npm run test:live` after the migration                                               | passed: 6 agents across us-east-1 and us-east-2 against a 2.00 USD budget, 2 committed, 4 denied, 9 OCC `40001` conflicts, budget floored at 0.00 USD, vendor 2.00 USD |

`test:live` ran as configured (`admin`): its setup inserts accounts and its cleanup deletes ledger
rows, which `stub_app` may not do, and the script has no separate user for the racing writers.

## 4. Problems hit

- DSQL accepts CHECK on an existing table only as `NOT VALID` plus an asynchronous `VALIDATE`.
- DSQL refuses `ADD COLUMN` with `NOT NULL` or `DEFAULT`, which had silently left production a
  schema behind the code: the live cross-region test failed on a missing column before any change.
- Passing `credentials: undefined` to `DsqlSigner` does not fall back to the default chain; it
  fails with "Resolved credential object is not valid". The key is now set only when a role ARN is.
- The local default AWS credential chain resolves to the account root key (STS: "Roles may not be
  assumed by root accounts"), so local scripts have been signing DSQL tokens as root. The probe
  used a named profile instead.
- Node's happy-eyeballs default (250 ms per address family) timed out reaching the clusters from
  this network under parallel connects (`ETIMEDOUT` on IPv4, `EHOSTUNREACH` on IPv6); local runs
  used `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=3000`.

## 5. Still needed on Vercel (not done here)

1. Set `AWS_ROLE_ARN` to the stack output `RoleArn`, `AWS_REGION=us-east-1`, `DSQL_USER=stub_app`
   (or remove `DSQL_USER`), and a long random `ADMIN_TOKEN`, for Production.
2. Confirm the project issues OIDC tokens in Team issuer mode (the local development token's issuer
   is `https://oidc.vercel.com/<team>`).
3. Remove any `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from the project, then deactivate the
   key that served production.
4. Merge and deploy, then measure: `GET /api/accounts` without a credential should answer 401, and a
   spend should commit.

## Rollback

- Code: `DSQL_USER=admin` restores the old database identity; unset `AWS_ROLE_ARN` to use the
  default chain.
- Database: `ALTER TABLE accounts DROP CONSTRAINT accounts_balance_nonnegative` (same for
  `account_shards`); `AWS IAM REVOKE stub_app FROM '<role arn>'`; `DROP ROLE stub_app` after
  revoking its grants.
- IAM: disable termination protection on `stub-app-identity`, then delete the stack.
- Clusters: `UpdateCluster deletionProtectionEnabled=false`.

---

# Remaining findings, closed and measured (26 Nov 2026)

Each section below was measured before and after the change with the same call or script. All AWS
reads and writes went through the AWS MCP server as the operator's IAM user; local scripts ran
under the named operator profile, never the root key. Every new AWS resource is a CloudFormation
stack built from `infra/` with termination protection on (see F07).

## F03: backups and a tested restore (REL09-BP02, REL09-BP03, REL09-BP05, REL13-BP02)

Docs checked first: AWS Backup supports Aurora DSQL single- and multi-Region clusters, always as
full backups; a multi-Region cluster needs a recovery point per Region (one Region's backup is not
a point for the other), and a multi-Region restore needs an identical copy of the point in both
peer Regions, so the primary's plan copies every point to the peer vault. A restore always creates
a new cluster. The account's AWS Backup opt-in for DSQL was already on in both Regions.

| Measure (both Regions)                        | Before (09:30 UTC) | After                                                                      |
| --------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| Backup plans covering the ledger              | 0                  | 2 (`stub-ledger-daily`, 05:00 UTC daily, 35-day retention)                 |
| Backup vaults                                 | 0                  | 2 (`stub-ledger`, Vault Lock governance mode, min 7 / max 400 days)        |
| Protected resources                           | 0                  | 2 of 2 clusters                                                            |
| Recovery points                               | 0                  | 3 (one on-demand per Region, plus the us-east-1 point copied to us-east-2) |
| Cross-Region copy rule (primary → peer vault) | none               | on the daily rule                                                          |
| Restores ever tested                          | 0                  | 1, verified, 2 min 9 s                                                     |
| RPO for logical damage (bad write, DELETE)    | undefined          | 24 h (daily point); Region loss stays at RPO 0 through the peer            |

On-demand backup jobs (`StartBackupJob`, 09:34 UTC): us-east-1 finished in 4 min 10 s, us-east-2
in 5 min 40 s, 211,877 bytes each. The copy of the us-east-1 point to the us-east-2 vault took
8 min 33 s.

### Restore drill

`StartRestoreJob` on the us-east-1 point into a new single-Region cluster with deletion protection
off, 09:42:38 UTC. The job completed at 09:44:46.9 (**2 min 8.7 s**); the first query against the
new cluster answered at 09:44:57 (2 min 19 s from the request). `npx tsx
scripts/ledger-fingerprint.ts <endpoint> <region>` read both clusters as admin:

| Fingerprint                                 | Source cluster     | Restored cluster |
| ------------------------------------------- | ------------------ | ---------------- |
| Rows: accounts / entries / denials          | 7 / 30 / 2         | 7 / 30 / 2       |
| Rows: reservations / query_cache / policies | 2 / 2 / 1          | 2 / 2 / 1        |
| Hash-chain problems (`verifyChain`)         | 0                  | 0                |
| SHA-256 of every entry hash                 | `447914ae…14e3b8`  | identical        |
| Sum of balances                             | 1,101.76 USD       | identical        |
| SHA-256 of every account's chain head       | `571ea294…af08e60` | identical        |

The temporary cluster was deleted at 09:45:16 (`DeleteCluster` → `DELETING`, then gone).

### Problems hit

- `StartRestoreJob` with `ResourceType: AuroraDSQL` (the name the docs use) fails with "Invalid
  resource type"; the recovery point's own type is `DSQL`, and leaving the field out works.
- Vault Lock in governance mode means the 7-day on-demand points cannot be deleted early, by
  design; compliance mode was not used because it can never be undone.
- Not done: the report's copy to a vault in a second account. There is no AWS Organizations or
  second account; the copy is cross-Region only.

### Cost

AWS Backup warm storage for about 105 full points of ~0.2 MB (35 days × 2 Regions + 35 copies):
under $0.01 a month at today's ledger size, growing linearly with it. Restore tests: the
temporary cluster lived 2 minutes.

## F05: the app fails over to the peer Region on its own (REL10-BP01, REL13-BP01, REL13-BP05)

Before, `db/client.ts` built one pool on `DSQL_ENDPOINT`; losing that endpoint meant changing an env
var and redeploying. Now `getPool()` returns a `FailoverPool` (`db/failover.ts`) over both regional
endpoints when `DSQL_ENDPOINT_PEER` is set. A connection the primary cannot open is retried on the
peer in the same call; later calls stay on the peer; after `DSQL_FAILBACK_AFTER_MS` (60 s) a
background probe with a 3 s bound moves them back once the primary answers. Only endpoint failures
switch (network errors, connect timeouts, SQLSTATE `08`, `28`, `57P0x`); `40001`, `23514` and
`42501` never do, so OCC retries and the CHECK refusal behave as before. A query that fails
mid-flight is not retried on the peer, so a write is never sent twice.

`npm run drill:failover [blackhole|dns]` creates two throwaway accounts, makes a baseline spend,
then points the primary at a blocked address and spends again. "Pinned to primary" is the old
behaviour (one pool on the primary), measured in the same run. Nothing is deleted except the
drill's own rows. Run from this laptop (India) against us-east-1 and us-east-2, 09:43-09:45 UTC:

| Blocked primary                     | Connect timeout | Pinned to primary (before)                  | First spend during the outage (after) | Next spend |
| ----------------------------------- | --------------- | ------------------------------------------- | ------------------------------------- | ---------- |
| Unroutable address, packets dropped | 10 s (default)  | fails after 10.0 s, and every call after it | **committed on us-east-2 in 14.87 s** | 3.0 s      |
| Unroutable address, packets dropped | 3 s             | fails after 3.0 s                           | **committed on us-east-2 in 7.59 s**  | 2.8 s      |
| Endpoint name that does not resolve | 10 s            | fails after 0.06 s (`ENOTFOUND`)            | **committed on us-east-2 in 4.55 s**  | 3.0 s      |

Baseline spend on the healthy primary from the same laptop: 4.7-4.8 s (cold connection, IAM
token, three round trips across the ocean). Each drill left the budget at 9.97 of 10.00 USD: three
0.01 USD spends committed, none lost or doubled.

Objectives, written down for the first time: Region loss, RPO 0 (writes are synchronously
replicated to the peer) and RTO about one connect timeout plus one peer connection, 15 s at the
defaults and about 8 s with `DSQL_CONNECTION_TIMEOUT_MS=3000`, which suits Vercel functions in
us-east-1 talking to a cluster in the same Region. Logical damage: RPO 24 h and RTO about
2.5 minutes plus repointing (F03).

`test/invariant/failover.test.ts` (4 tests) covers the switch, staying on the peer without touching
the primary, failback only after a probe answers, and no switch on SQL errors. `npm run verify`:
17 files, 98 tests passed.

Not done: AWS FIS has an Aurora DSQL action (`aws:dsql:cluster-connection-failure`, 1 minute to
12 hours, a percentage of connections) that would block the real primary instead of a client-side
address. It was not run because the production app on Vercel does not have this failover code yet,
so injecting failures on the primary would cut the live app off; run it once the branch is
deployed with `DSQL_ENDPOINT_PEER` and `DSQL_REGION_PEER` set (FIS bills $0.10 per action-minute).

## F08: security scanning in CI and a publish with no stored token (SEC11-BP03, SEC11-BP08, SEC06-BP01)

| Measure                                                        | Before                                                     | After                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Security jobs in CI                                            | 0 (lint, format, typecheck, tests, build only)             | 4 in `security.yml`: npm audit, gitleaks, CodeQL, cfn-lint; on push, pull request and weekly |
| `npm audit --omit=dev` (production dependencies)               | 5 advisories: 1 critical (Next.js RCE), 3 high, 1 moderate | 0                                                                                            |
| `npm audit --audit-level=high` (all dependencies, the CI gate) | would fail (the 4 above)                                   | passes; 14 moderate left, all in the dev-only ESLint chain                                   |
| Secrets in git history (`gitleaks git`, 111 commits)           | not scanned                                                | 0 found                                                                                      |
| Workflow lint (`actionlint` over `.github/workflows`)          | not run                                                    | 0 findings                                                                                   |
| Long-lived npm credential the publish workflow reads           | 1 (`NPM_TOKEN`)                                            | 0: npm trusted publishing over GitHub OIDC (`id-token: write`), npm CLI 11.5.1 or later      |
| Dependabot                                                     | off                                                        | weekly for the app, the SDK and the workflow actions                                         |

The fix behind the audit numbers is `npm audit fix` (no `--force`): Next.js 16.2.9 → 16.4.6 and
sharp → 0.35.5 through the lockfile only. `npm run verify` and `npm run build` pass on it.

The scans were run locally with the same tools: `npm audit` as above, gitleaks 8.30.1 (`gitleaks
git --redact .`: "no leaks found"; a directory scan finds 16 hits, all in git-ignored files: `.env`,
`.env.local`, `.next/` and `node_modules/`), actionlint 1.7.12 and cfn-lint over `infra/*.yaml`.
CodeQL runs only on GitHub (the repository is public, so it needs no Advanced Security licence).

The owner must do one thing on npmjs.com before the next `sdk-v*` tag (it fails to publish until
then): add a trusted publisher for `trystub` (GitHub Actions, `ashutosh887/stub`, workflow
`publish-sdk.yml`), then delete the `NPM_TOKEN` repository secret and revoke that token. Steps are in
`CONTRIBUTING.md`.
