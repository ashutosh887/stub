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
| CHECK constraints on balance tables                                                                           | 0                                                  | 3, all `convalidated = true` (2 at first, plus `accounts_balance_within_cap` later the same day)  |
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

## 5. Vercel switch (done 26 Nov 2026 17:20 UTC, see "Live after deploy")

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

## F09: only the app role and the operators may connect (SEC05-BP01, SEC03-BP01)

Docs checked first: Aurora DSQL supports resource-based policies on a cluster (`PutClusterPolicy`,
or `PolicyDocument` on `AWS::DSQL::Cluster`), evaluated on `dsql:DbConnect` and
`dsql:DbConnectAdmin`. Both clusters now carry the same policy, kept in
`infra/stub-clusters.yaml`: deny `dsql:DbConnect` unless `aws:PrincipalArn` is the `stub-app` role
or an operator, and deny `dsql:DbConnectAdmin` unless it is an operator (the operator IAM user and
the account root, kept as break-glass). An explicit deny in the cluster policy wins over any
identity policy, so a principal granted `dsql:*` elsewhere still cannot connect.

The probe: a throwaway role `stub-wa-probe` with an identity policy allowing `dsql:DbConnect` and
`dsql:DbConnectAdmin` on both clusters, assumed locally through a temporary profile file, then
`npm run check:db` as `admin` and as `stub_app` against each cluster. The role was deleted after the
second run (`GetRole` → `NoSuchEntity`).

| Measure                                                         | Before (09:53 UTC)                                 | After (09:54 UTC, policy applied at 09:54:04) |
| --------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Cluster resource policies                                       | 0 of 2 (`GetClusterPolicy` → not found)            | 2 of 2                                        |
| Unlisted principal connects as `admin`                          | 2 of 2 clusters                                    | 0 of 2 ("access denied")                      |
| Operator connects as `admin`                                    | 2 of 2                                             | 2 of 2                                        |
| `stub-app` role, simulated with the cluster policy: `DbConnect` | allowed (section 3a, 09:23 UTC, no cluster policy) | allowed, both clusters                        |
| `stub-app` role, simulated: `DbConnectAdmin`                    | implicit deny (section 3a)                         | explicit deny, both clusters                  |
| `stub-wa-probe`, simulated: `DbConnect`, `DbConnectAdmin`       | not simulated; connected live as `admin` (row 2)   | explicit deny, both clusters                  |

The `stub-app` role trusts only Vercel's production OIDC tokens, so it cannot be assumed from here;
`iam:SimulatePrincipalPolicy` with the cluster policy as `ResourcePolicy` stands in for a live
connect (the simulator rejects `"Resource": "*"`, so the simulated copy names the cluster ARN). The
first real connect as `stub-app` happens on Vercel after the deploy: `GET /api/health` answering
`"db": "up"` is the check. The `PutClusterPolicy` calls also fired the new
`wa-dsql-destructive-calls` EventBridge rule once per Region (F04).

Problem hit: a policy that names principals by ARN must be edited when an operator changes; adding
a new operator means updating the `OperatorPrincipalArns` parameter of both `stub-clusters` stacks.
No cost.

## F04: audit trail, threat detection and alarms (SEC04-BP01, SEC04-BP02, REL06-BP01, REL06-BP03, REL11-BP06)

Built from the skill's guardrails procedure: every control names its best practice ID, carries the
tags `wa-best-practice` and `managed-by=aws-well-architected-review` and a `wa-` name prefix, and is
checked by making it fire. Two stacks: `stub-audit` (us-east-1 only: trail, log bucket, the AWS
Config service-linked role) and `stub-detection` (one per Region).

| Measure (us-east-1 + us-east-2) | Before (09:30 UTC) | After (10:0x UTC)                                                                                                                                                                |
| ------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CloudTrail trails               | 0                  | 1 multi-Region trail `wa-stub-audit`: management events, read and write, log file validation on, logging, first delivery 09:58:46                                                |
| Log bucket controls             | n/a                | versioned, SSE-S3, public access blocked, bucket-owner-enforced, `Deny` on `aws:SecureTransport=false`, Glacier IR at 90 days, expiry at 365                                     |
| GuardDuty detectors             | 0                  | 2, `ENABLED`, foundational sources only (S3, EKS, EBS malware, RDS, Lambda and runtime add-ons off)                                                                              |
| CloudWatch alarms               | 0                  | 4: `OccConflicts` ≥ 50 per 5 min and `QueryTimeouts` ≥ 1 per 5 min, per cluster                                                                                                  |
| SNS alert topics                | 0                  | 2 `wa-stub-ops-alerts`, KMS customer managed key (rotation on), publish allowed only to CloudWatch alarms and EventBridge rules named `wa-*` in this account, **no subscribers** |
| EventBridge rules               | 0                  | 4: GuardDuty findings of severity ≥ 4, and `DeleteCluster`, `UpdateCluster`, `PutClusterPolicy`, `DeleteClusterPolicy` on DSQL                                                   |
| AWS Config recorders            | 0                  | 2, recording only `AWS::DSQL::Cluster`, continuous                                                                                                                               |
| AWS Config rules                | 0                  | 2, managed rule `DSQL_CLUSTER_DELETION_PROTECTION_ENABLED`                                                                                                                       |

Seen working:

- Alarm path: `SetAlarmState` on `wa-dsql-query-timeouts-us-east-1` (09:53:12) → alarm history
  "Successfully executed action arn:aws:sns:…:wa-stub-ops-alerts", so the alarm can publish to the
  encrypted topic through the key policy. This tests the action, not the metric condition; the
  conditions use the cluster's own `AWS/AuroraDSQL` metrics (`ClusterId` dimension), which
  `ListMetrics` shows for both clusters.
- Destructive-call rule: the F09 `PutClusterPolicy` calls (09:54) show 1 `Invocations` and 0
  `FailedInvocations` on `wa-dsql-destructive-calls` in each Region.
- Trail: `GetTrailStatus` `IsLogging=True`, latest delivery 09:58:46 UTC, no delivery error.
- Config rule: a throwaway single-Region cluster created at 09:53 with deletion protection off
  (tagged `managed-by=aws-well-architected-review`) was reported `NON_COMPLIANT` by
  `wa-dsql-cluster-deletion-protection-enabled` at 10:05:26, then deleted at 10:10. Its
  `DeleteCluster` call also fired `wa-dsql-destructive-calls` (1 invocation, 0 failed). The two
  ledger clusters had not been evaluated yet at 10:11: the recorder had not recorded them, while it
  recorded the test cluster right after a tag change on it. Their `COMPLIANT` result is still to be
  seen.

Not alarmed: the app's denial rate. Denials go to the `denials` table and Vercel's stdout, not to
CloudWatch, so there is no metric to alarm on until the app publishes one (or a log drain does).

### Problems hit

- The first `stub-detection` deploy put the trail, its bucket and the Config service-linked role in
  the same stack as the recorder. CloudFormation started the recorder 35 s before the role finished
  creating; the handler then failed with "ConfigurationRecorder … already exists", and the rollback
  could not delete the role because the orphaned recorder still used it (`ROLLBACK_FAILED`). Fixed
  by deleting the orphan recorder, the stack and its retained bucket, and splitting the
  account-level pieces into `stub-audit.yaml`, deployed first.
- The second deploy hung on the recorder: `DeliveryChannel` had `DependsOn: Recorder`, while
  CloudFormation's recorder handler waits for a delivery channel before it reports success. Removing
  the `DependsOn` (as AWS's own samples do) deployed both Regions in 2 minutes.
- GuardDuty turns on three feature flags CloudFormation's schema does not list (`AI_ANALYST`,
  `AI_PROTECTION`) or that conflict with `RUNTIME_MONITORING` (`EKS_RUNTIME_MONITORING`), all
  `DISABLED`. Drift detection reports them on the detector; nothing else in the stack drifts (F07).

### Cost per month

KMS: 2 customer managed keys, $2.00 (rotation adds $1 per key after each of the first two yearly
rotations). CloudWatch: 4 alarms, $0.40. GuardDuty: free for 30 days per Region, then billed on the
CloudTrail management events and VPC flow and DNS logs it analyses; with no EC2 or EKS here, likely
under $1 per Region. CloudTrail: the first management-event trail is free; S3 for its logs, cents.
AWS Config: $0.003 per recorded change of a DSQL cluster and $0.001 per rule evaluation, cents.
EventBridge rules on AWS service events and SNS at this volume: free. About $2.50 a month plus
GuardDuty after the trial.

## F07: what is live is what is in the repo (SEC01-BP05, REL08-BP01)

Every resource created for F03, F04 and F09 was created by CloudFormation from `infra/`, and the two
running clusters were brought under CloudFormation by resource import (no change to the clusters:
an import only records them). Deployed templates were read back with `GetTemplate` and hashed.

| Measure                                                       | Before (09:30 UTC)                   | After (10:0x UTC)                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Stub stacks                                                   | 1 (`stub-app-identity`, 2 resources) | 8 across 2 Regions, 38 resources                                                                                    |
| Ledger clusters managed by CloudFormation                     | 0 of 2                               | 2 of 2 (`stub-clusters`, `DeletionPolicy: Retain`)                                                                  |
| Stacks with termination protection                            | 1 of 1                               | 8 of 8                                                                                                              |
| Deployed template identical to the file in `infra/` (SHA-256) | 1 of 1                               | 8 of 8                                                                                                              |
| Drift detection                                               | not run                              | 6 of 8 `IN_SYNC`; both `stub-detection` stacks drift only on GuardDuty's 3 service-added `DISABLED` flags (F04)     |
| Guardrail test over the templates                             | none                                 | `test/invariant/infrastructure.test.ts`, 6 tests; giving the app role `DbConnectAdmin` in the template fails 1 of 6 |
| Template lint in CI                                           | none                                 | `cfn-lint infra/*.yaml` in `security.yml`, 0 findings                                                               |

| Stack (Region)                          | Template              | Resources | Holds                                                                                       |
| --------------------------------------- | --------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `stub-app-identity` (us-east-1)         | `stub-app-role.yaml`  | 2         | Vercel OIDC provider, `stub-app` role                                                       |
| `stub-clusters` (us-east-1, us-east-2)  | `stub-clusters.yaml`  | 1 each    | the imported cluster, deletion protection, connect policy                                   |
| `stub-backup` (us-east-1, us-east-2)    | `stub-backup.yaml`    | 4 each    | vault with Vault Lock, daily plan (+ copy rule in us-east-1), selection, role               |
| `stub-audit` (us-east-1)                | `stub-audit.yaml`     | 4         | trail, log bucket and its policy, AWS Config service-linked role                            |
| `stub-detection` (us-east-1, us-east-2) | `stub-detection.yaml` | 11 each   | GuardDuty, KMS key, SNS topic and policy, 2 alarms, 2 rules, Config recorder, channel, rule |

### Problems hit

- The first import listed only the peer in `MultiRegionProperties.Clusters`; drift then reported the
  Region's own ARN as added, because `GetCluster` returns both. The fix was to delete the stack (the
  cluster stayed: `DeletionPolicy: Retain`, and deletion protection is on) and import again with
  both ARNs in `GetCluster`'s order. Drift is now `IN_SYNC` on both, including the policy document.
- An import change set cannot add stack tags, so the cluster stacks carry none.

Still outside code: the account's AWS Backup opt-in for DSQL (already on, an account setting), the
database-side `AWS IAM GRANT stub_app` mapping (`npm run db:app-role -- grant`), the operator IAM
user and the root key, and the Vercel project settings.

---

# Second review gaps, closed and measured (26 Nov 2026)

The second Well-Architected pass (same day) left F02 open in branch code and added F26, F27 and
F28; F07 kept two drifting stacks and no pipeline. Each section below was measured before and after
with the same command. AWS work went through the AWS MCP server as the operator; nothing used the
root key.

## F02: every admin and export route is gated, and the token compare is constant time (SEC03-BP01, SEC01-BP06)

What changed in code:

- `/api/export` and `/api/export/journal` were bare `export async function GET` handlers with no
  check; both now run through `withRoute({ admin: true })`, the same gate as every admin route, so
  production with `ADMIN_TOKEN` unset answers 401 (fail closed).
- `/api/audit/verify` returned every account's name, id, entry count and chain head to anyone; it
  is admin now (its only caller is the admin-gated `/audit` page).
- `/api/audit/tamper-demo`, `/api/harness`, `/api/incident` and `/api/stress` checked
  `isAdmin(request)` inside the handler; they now use the `admin: true` option, so the gate is in
  one place and the guardrail below can see it.
- `lib/api.ts` `tokenMatches`: SHA-256 of the supplied and the configured token, compared with
  `crypto.timingSafeEqual` (equal-length digests, so no length leak and no throw on a length
  mismatch). `isAdmin`, `adminPageAllowed` and the login route all use it; the `===` compares are
  gone.
- `/dashboard` had its own gate that was open whenever `ADMIN_TOKEN` was unset, production
  included, and compared with `!==`; it now calls `adminPageAllowed()`.
- `POST /api/auth` with no `ADMIN_TOKEN` in production now answers 401 instead of
  `{ authed: true }`.

Test: `test/invariant/admin-routes.test.ts` imports each route handler and calls it in production
mode (`VERCEL_ENV=production`) with the data layer replaced by an in-memory store. For each of the
20 admin handlers: 401 with no token configured (with or without a bearer), 401 with no token, a
wrong bearer, the right token plus one character and a wrong cookie, then 200 with the right bearer
and 200 with the right cookie. For the 4 agent routes: 401 with no credential and with an unknown
key, past the gate with the admin cookie.

| Measure                                                   | Before (HEAD `038e1f3`, 12:45 UTC)                  | After (12:45 UTC) |
| --------------------------------------------------------- | --------------------------------------------------- | ----------------- |
| `npx vitest run test/invariant/admin-routes.test.ts`      | 8 failed, 38 passed of 46                           | 46 passed of 46   |
| Admin or data routes answering 200 with no token, in prod | 3 (`export`, `export/journal`, `audit/verify`)      | 0                 |
| Token compares that are not constant time                 | 4 (`isAdmin`, `adminPageAllowed`, login, dashboard) | 0                 |
| Pages open in production with `ADMIN_TOKEN` unset         | 1 (`/dashboard`)                                    | 0                 |

The 8 failures before: the three open routes, twice each (no token configured, wrong token), the
missing `tokenMatches`, and the login route issuing `{ authed: true }` in production with no token.
"Before" was measured by stashing `app/` and `lib/` and running the new test file against HEAD.

Not closed here: the live site. Production still runs the old build with `ADMIN_TOKEN` unset, so
the six probed routes keep answering 200 until this branch is deployed with `ADMIN_TOKEN` set
(Vercel settings; F01 and F02 share that deploy).

### Every route under `app/api`

| Route                    | Methods                  | Access             | Why                                                                                    |
| ------------------------ | ------------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| `/api/accounts`          | GET                      | admin              | balances and caps                                                                      |
| `/api/accounts/shard`    | POST                     | admin              | rewrites an account's balance rows                                                     |
| `/api/agents`            | GET, POST                | admin              | lists agents, issues API keys                                                          |
| `/api/audit/tamper-demo` | POST                     | admin              | reads every entry; returns one entry's id and amount                                   |
| `/api/audit/verify`      | GET                      | admin              | account names, ids, entry counts, chain heads                                          |
| `/api/export`            | GET                      | admin              | the full ledger as CSV                                                                 |
| `/api/export/journal`    | GET                      | admin              | the journal as CSV                                                                     |
| `/api/freeze`            | POST                     | admin              | kill switch                                                                            |
| `/api/harness`           | POST                     | admin              | runs the in-memory exactly-once harness (CPU)                                          |
| `/api/incident`          | POST                     | admin              | drill; also refused on the app's DB role                                               |
| `/api/ledger`            | GET                      | admin              | entries and denials                                                                    |
| `/api/policies`          | GET, POST, PATCH, DELETE | admin              | spend policies                                                                         |
| `/api/policies/simulate` | POST                     | admin              | replays an account's spend history                                                     |
| `/api/query`             | POST                     | admin              | natural-language questions over the ledger                                             |
| `/api/stress`            | POST                     | admin              | drill; also refused on the app's DB role                                               |
| `/api/sweep`             | POST                     | admin              | releases expired holds                                                                 |
| `/api/spend`             | POST                     | agent key or admin | the product: an agent spends with its scoped key, bound to its own budget              |
| `/api/reserve`           | POST                     | agent key or admin | same, for holds                                                                        |
| `/api/settle`            | POST                     | agent key or admin | same                                                                                   |
| `/api/release`           | POST                     | agent key or admin | same                                                                                   |
| `/api/auth`              | POST                     | public by design   | the login itself; 20 a minute per IP, constant-time compare, 401 in prod with no token |
| `/api/auth`              | DELETE                   | public by design   | logout clears only the caller's own cookie                                             |
| `/api/health`            | GET                      | public by design   | uptime probe; returns up/down, the active Region and latency, no ledger data           |
| `/api/proof`             | POST                     | public by design   | the public least-privilege proof; each statement rolls back; per-IP and global limits  |

20 admin handlers, 4 agent-key handlers, 4 public handlers across 23 route files.

### Guardrail: no route without a gate or a written reason

`test/invariant/route-guard.test.ts` reads every `app/api/**/route.ts`, finds each exported
handler, and fails unless the handler runs through `withRoute` and is either `admin: true`, on the
`AGENT_ROUTES` list (and its file both resolves an agent key and falls back to `isAdmin(request)`),
or on the `PUBLIC_ROUTES` list with its reason. A bare `export async function GET` fails, and an
allowlist entry naming a handler that no longer exists fails.

| Measure                                              | Before (HEAD `038e1f3` routes)                                                                                      | After `93584e0`                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `npx vitest run test/invariant/route-guard.test.ts`  | 1 failed of 4                                                                                                       | 4 passed of 4                   |
| Handlers outside the rule                            | 7: `export`, `export/journal`, `audit/verify` (open); `tamper-demo`, `harness`, `incident`, `stress` (inline check) | 0                               |
| Break test: `admin: true` removed from `/api/export` | n/a                                                                                                                 | fails, naming `GET /api/export` |

## F28: the audit trail cannot be stopped, narrowed or emptied without a page (SEC04-BP01, SEC04-BP02)

Changed through the existing stacks, by change sets reviewed before each execute; no trail, bucket,
detector or cluster was replaced.

- `stub-detection` (both Regions): new rule `wa-audit-tampering` on the existing ops topic. It
  matches CloudTrail `StopLogging`, `DeleteTrail`, `UpdateTrail`, `PutEventSelectors`; GuardDuty
  `DeleteDetector` and every `UpdateDetector` (disabling the detector and disabling one feature are
  both `UpdateDetector`, so matching on a request field would miss the second); and
  `PutBucketPolicy`, `DeleteBucketPolicy`, `PutBucketLifecycle`, `DeleteBucketLifecycle`,
  `PutBucketVersioning` on the log bucket, which is the remaining way to purge it (a shorter
  lifecycle). Checked first with `events:TestEventPattern`: 5 of 5 tampering events matched,
  `StartLogging`, another bucket's policy and a DSQL call did not.
- `stub-audit`: bucket policy statement `DenyLogDeletes`, `Deny` `s3:DeleteObject*` on every object
  for every principal. S3 lifecycle expiry still runs: it does not use `DeleteObject` and bucket
  policy denies do not apply to it (S3 user guide, "Troubleshooting Amazon S3 Lifecycle issues").
  Object Lock was not turned on: the bucket was created without it, and a deny policy needs no
  bucket change.
- Log file validation was already on (`LogFileValidationEnabled: true` live and in the template
  since F04; digest files delivered, latest 14:43:11 UTC). Nothing to change.

| Measure                                                                                                      | Before (14:52 UTC)                                     | After                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| EventBridge rules watching the trail or GuardDuty, us-east-1 / us-east-2                                     | 0 / 0                                                  | 1 / 1 (`wa-audit-tampering`)                                           |
| Operator `s3:DeleteObject`, `s3:DeleteObjectVersion` on a log object (IAM simulation with the bucket policy) | allowed, allowed                                       | explicitDeny, explicitDeny                                             |
| Live delete of a probe object and of its version (15:00:07)                                                  | n/a                                                    | `AccessDenied` ("explicit deny in a resource-based policy") both times |
| Lifecycle rule `retain-then-expire`                                                                          | Enabled, 365 days                                      | Enabled, 365 days                                                      |
| Trail logging, log file validation                                                                           | on, on                                                 | on, on                                                                 |
| Deployed template = file (SHA-256)                                                                           | `stub-audit` `ea77530c…`, `stub-detection` `15d067c9…` | `stub-audit` `f89d6c6c…`, `stub-detection` `2b05e90b…` (both Regions)  |

Proof that the rule fires. Harmless matching calls: `UpdateTrail` with the trail's own settings in
us-east-1 at 15:00:02 (settings read before and after: identical), `UpdateDetector` with the same
`FIFTEEN_MINUTES` publishing frequency in each Region at 15:00:04 and 15:00:05; the `stub-audit`
deploy itself called `PutBucketPolicy` at 14:59. CloudWatch, read at 15:02:13 UTC, one-minute sums:

| Region    | `AWS/Events` `MatchedEvents` (`wa-audit-tampering`) | `Invocations`        | `FailedInvocations` | `AWS/SNS` `NumberOfMessagesPublished` (`wa-stub-ops-alerts`) |
| --------- | --------------------------------------------------- | -------------------- | ------------------- | ------------------------------------------------------------ |
| us-east-1 | 14:59 → 1, 15:00 → 2                                | 14:59 → 1, 15:00 → 2 | 0                   | 14:59 → 1, 15:00 → 2                                         |
| us-east-2 | 15:00 → 1                                           | 15:00 → 1            | 0                   | 15:00 → 1                                                    |

(Each Region also shows one match at 14:53 with no invocation: the first deploy attempt, which
rolled back, see F07.) The probe object `wa-probe/delete-probe.txt` stays in the bucket; lifecycle
expires it with the logs.

Still open: the trail and its bucket live in the workload account, so an administrator of this
account can still remove the bucket policy (it pages now) or delete the trail (it pages). An
Organizations log-archive account with Object Lock is the full fix and needs AWS Organizations
(F06). The topic's email subscription is still unconfirmed (F04), so the pages reach no person yet.

Cost: EventBridge rules on AWS service events, the bucket policy and the SNS publishes at this
volume are free. New monthly cost: $0.

## F07: drift closed, and the stacks deploy from `main` through a narrow OIDC role (SEC01-BP06, REL08-BP01, SEC02-BP02)

### GuardDuty drift

GuardDuty adds `AI_PROTECTION`, `AI_ANALYST` and `EKS_RUNTIME_MONITORING` (all `DISABLED`) to every
detector, which drift reported on both `stub-detection` stacks. The intended setting is the one
running: foundational sources only, every paid feature off, because nothing here runs EC2, EKS,
Lambda or AI workloads. So the template now lists all nine features as `DISABLED`.

A normal update cannot apply that: the first change set (14:53, both Regions) failed with "The
request was rejected because EKS_RUNTIME_MONITORING and RUNTIME_MONITORING cannot be provided in the
same request" and rolled back cleanly (`UPDATE_ROLLBACK_COMPLETE`). The detector was instead moved
under the full template without a GuardDuty write, each step its own reviewed change set:

1. 14:55 add `DeletionPolicy: Retain` to the detector, and the F28 rule (change set: rule `Add`,
   detector `Modify` scope `DeletionPolicy`/`UpdateReplacePolicy` only).
2. 14:57 remove the detector from the stack (change set: `Remove`, `PolicyAction: Retain`);
   GuardDuty read straight after: 1 detector, `ENABLED`, in each Region.
3. 14:58 import it back with the nine-feature definition (change set: `Import` only;
   `IMPORT_COMPLETE`).
4. 14:58 the final template (change set: no resource changes; puts back the `DetectorId` output).

`cfn-lint` 1.46 rejects `AI_PROTECTION` and `AI_ANALYST` (E3030, its own list of names), while the
live `AWS::GuardDuty::Detector` schema (`DescribeType`) types `Name` as any string up to 128
characters; the detector carries a `cfn-lint` `ignore_checks: [E3030]` metadata entry for that.
Consequence to know: any future template change to the detector's properties will hit the same
GuardDuty refusal; repeat steps 1 to 4 for it (the incident-response guide links here).

### Pipeline: `infra.yml` and `stub-deploy-role.yaml`

- `.github/workflows/infra.yml`: on a pull request touching `infra/`, runs `cfn-lint infra/*.yaml`
  and `test/invariant/infrastructure.test.ts`. On a push to `main`, after both pass, deploys the
  eight stack instances one at a time: change set with the stack's previous parameter values,
  printed, refused if any change removes or replaces a resource (left for an operator), executed,
  then the deployed template's SHA-256 compared with the file. No AWS key is stored: the job gets
  an OIDC token (`id-token: write`, that job only) and assumes the role named by the repository
  variable `AWS_INFRA_DEPLOY_ROLE_ARN`.
- `infra/stub-deploy-role.yaml`, stack `stub-deploy-role` (us-east-1, termination protection on,
  deployed by the operator and never by the pipeline): GitHub's OIDC provider; `stub-infra-deploy`,
  trusted only for `aud = sts.amazonaws.com` and `sub = repo:<owner>/<repo>:ref:refs/heads/main`,
  allowed only to create, review and run change sets on the five named stacks in the two Regions,
  and only with `cloudformation:RoleArn` set to `stub-infra-cfn-exec`; and `stub-infra-cfn-exec`,
  which only CloudFormation can assume, holding the permissions listed by each resource type's own
  handler schema (`DescribeType`), scoped to the app and backup roles, the log bucket and the trail,
  with explicit denies on stopping or deleting the trail, deleting clusters, vaults, plans, recovery
  points, the detector, the bucket, its policy or any object, disabling or deleting the alert key,
  stopping or deleting Config, and deleting or disabling `wa-audit-tampering`.

Setup left for the owner, outside code: set repository variables `AWS_INFRA_DEPLOY_ROLE_ARN` and
`AWS_INFRA_EXEC_ROLE_ARN` from the stack outputs. The workflow has not run: the branch is not
pushed. Its first run on `main` also records `stub-infra-cfn-exec` as each stack's service role.

IAM policy simulation of the two roles (15:03 UTC, 28 cases, every result as designed):

| Principal             | Call                                                                                                                                                                      | Decision               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `stub-infra-deploy`   | `CreateChangeSet` on `stub-detection` (us-east-1) and `stub-clusters` (us-east-2) through the execution role                                                              | allowed                |
| `stub-infra-deploy`   | `CreateChangeSet` with its own credentials (no execution role)                                                                                                            | implicitDeny           |
| `stub-infra-deploy`   | `CreateChangeSet` on `stub-deploy-role`, or in eu-west-1                                                                                                                  | implicitDeny           |
| `stub-infra-deploy`   | `ExecuteChangeSet` on `stub-audit`                                                                                                                                        | allowed                |
| `stub-infra-deploy`   | `DeleteStack`, `UpdateTerminationProtection`                                                                                                                              | implicitDeny           |
| `stub-infra-deploy`   | `iam:PassRole` of the execution role to CloudFormation / to Lambda                                                                                                        | allowed / implicitDeny |
| `stub-infra-deploy`   | `s3:GetObject` on audit logs, `dsql:DbConnectAdmin`                                                                                                                       | implicitDeny           |
| `stub-infra-cfn-exec` | `guardduty:UpdateDetector`, `s3:PutBucketPolicy` on the log bucket, `events:PutRule`, attach a backup policy to a `stub-backup-*` role                                    | allowed                |
| `stub-infra-cfn-exec` | attach `AdministratorAccess` to a backup role or to `stub-app`, `PutRolePolicy` on another role, `PutUserPolicy`                                                          | implicitDeny           |
| `stub-infra-cfn-exec` | `StopLogging`, `DeleteTrail`, `DeleteCluster`, `DeleteDetector`, `DeleteRecoveryPoint`, `s3:DeleteObject` on logs, `DeleteRule wa-audit-tampering`, `ScheduleKeyDeletion` | explicitDeny           |

Residual risk, stated: whoever can merge to `main` can change the app role's inline policy or trust
through a template (the execution role may write `stub-app`'s inline policy). Branch protection on
`main` (F25) is the control for that; it is not set yet.

| Measure                                                | Before (re-review, 12:23 UTC) | After (15:02 UTC)                                                                                                                                                                |
| ------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drift detection                                        | 6 of 8 `IN_SYNC`              | 9 of 9 `IN_SYNC` (the 8 plus `stub-deploy-role`)                                                                                                                                 |
| Deployed template = file in `infra/` (SHA-256)         | 8 of 8                        | 9 of 9                                                                                                                                                                           |
| Stacks with termination protection                     | 8 of 8                        | 9 of 9                                                                                                                                                                           |
| How stacks are applied                                 | by hand                       | `infra.yml` from `main` through OIDC (not yet run)                                                                                                                               |
| AWS keys stored in GitHub                              | 0                             | 0                                                                                                                                                                                |
| `npx vitest run test/invariant/infrastructure.test.ts` | 6 tests                       | 12 passed of 12; each of 4 break tests fails 1 or 2 (rule without `StopLogging`, role allowed its own stack, a static key in the workflow, execution role allowed `StopLogging`) |
| `cfn-lint infra/*.yaml`                                | 0 findings (5 templates)      | 0 findings (6 templates)                                                                                                                                                         |

Cost: IAM roles, the OIDC provider, CloudFormation and drift detection are free. New monthly cost:
$0.

## F26 and F27: an incident response guide and a data classification (SEC10-BP01, SEC10-BP02, REL12-BP01, SEC07-BP01, SEC07-BP03)

- `docs/incident-response.md`: severity levels; the freeze lever with written criteria for
  freezing everything or one account (closes F24's "lever without criteria"); one playbook for each
  of the 8 signals that exist (alarms `wa-dsql-occ-conflicts-*`, `wa-dsql-query-timeouts-*`; rules
  `wa-dsql-destructive-calls` with the Config rule, `wa-audit-tampering` split into the trail and
  bucket case and the GuardDuty case, `wa-guardduty-findings`; and two app signals with no alarm
  yet: the `dsql_endpoint_switch` log line for a failover and the `23514` balance refusal), each
  with what fired, the first five minutes, how to verify, how to roll back, and who acts (the
  operator). Recovery cites the measured restore drill (2 min 8.7 s job, 2 min 19 s to the first
  query, F03) and failover drill (4.55 to 14.87 s, F05).
- `docs/data-classification.md`: three classes; all 10 tables classed by column (Confidential for
  money, spend history, people and key hashes; Internal for identifiers and settings), retention
  taken from the app role's actual grants (no `DELETE` except on `policies`); every export and API
  response, logs, trail, Config snapshots, backups, findings and alerts; and the flows of
  Confidential data out of the ledger (OpenAI receives the question and aggregated totals when
  `OPENAI_API_KEY` is set; Vercel; the operator's exports).
- Both are tracked (`.gitignore` keeps the rest of `docs/` local) and linked from `README.md`
  under "Operations".

| Measure                                       | Before (re-review) | After                               |
| --------------------------------------------- | ------------------ | ----------------------------------- |
| Playbooks for the alarms and rules that exist | 0 of 8             | 8 of 8                              |
| Written freeze criteria                       | none               | 4 for freeze-all, 1 for one account |
| Tables with a classification                  | 0 of 10            | 10 of 10, by column                 |
| Exports and API responses classified          | 0                  | both exports and every route group  |

Not done here: a tabletop run of a playbook, a second responder, and an on-call rota (one operator
exists); alarms for the two app signals (the failover log line and `23514`) need a log drain or a
published metric first. No AWS resource was tagged with its class.

---

# Live after deploy (26 Nov 2026)

Production switched at 17:20 UTC: the Vercel project lost `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` and gained `AWS_ROLE_ARN`, `DSQL_USER=stub_app`, the peer endpoint and
`ADMIN_TOKEN`; `main` was fast-forwarded to the fix and deployed. Measured against
`https://trystub.vercel.app` at 17:22 UTC.

| Measure                                                                                 | Before deploy              | After deploy                                      |
| --------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| `GET /api/accounts`, `/api/ledger`, `/api/export`, `/api/export/journal`, no credential | 200 (re-review, 12:22 UTC) | 401 on all 4                                      |
| The same 4 routes with the admin token                                                  | n/a                        | 200 on all 4                                      |
| `POST /api/proof`: role the app connects as                                             | `admin` (refused to probe) | `stub_app`, `ran: true`                           |
| `POST /api/proof`: the 5 statements                                                     | not run                    | 5 of 5 refused: `23514`, `42501` ×4, 110 ms total |
| `GET /api/health`                                                                       | ok                         | ok, `us-east-1`, 3 ms                             |
| `AssumeRoleWithWebIdentity` for `stub-app` (CloudTrail, 17:15 to 17:30 UTC)             | 0 ever                     | 2, first at 17:22:10 UTC, no errors               |

`/api/proof` output, 17:22:15 UTC:

```
negative-balance  refused  23514  new row for relation "accounts" violates check constraint "accounts_balance_nonnegative"
rewrite-entry     refused  42501  permission denied for table entries
delete-entry      refused  42501  permission denied for table entries
create-table      refused  42501  permission denied for schema public
drop-entries      refused  42501  must be owner of table entries
```

### A bug the live check found

`npm run demo:agent` against production reserved and settled, but every `POST /api/settle`
answered 500: `TypeError: Do not know how to serialize a BigInt`. The settle committed (the log
shows `settle_settled`), then the response failed, and the SDK's retry came back `duplicate`. The
route had returned `bigint` fields since settlement shipped; `/api/release` had the same bug. Both
now return the amounts as strings, which the SDK's types already allowed.

The same check found two more: the demo agent called the now-gated admin routes without a token,
and every Vercel preview build failed with `Missing required env var: DSQL_ENDPOINT`, because
`lib/data.ts` opened the pool when the module loaded. The store now resolves its pool on first use,
so `next build` needs no database variable and CI no longer sets a placeholder endpoint.

# A second database invariant: no balance above its cap (26 Nov 2026)

The review's one open limit was that `stub_app` can raise a balance, because every spend, settle and
release writes that column. `CHECK (cap_micro IS NULL OR balance_micro <= cap_micro)`
(`accounts_balance_within_cap`) bounds it from above: a capped balance only falls on a spend or
hold and rises by no more than a settle or release refunds, nothing in the app writes `cap_micro`,
and vendors carry no cap. `account_shards` keeps only the lower bound, because a cap covers the sum
of an account's shards and a row CHECK sees one row.

Applied to the live cluster as `admin` through `npm run migrate`, 17:35:02 to 17:35:39 UTC, after a
precheck that returned 0 accounts above their cap and 0 vendors with a cap. `convalidated = true`
read back from both Regional endpoints. `/proof` gains a sixth statement, "Raise a budget above its
cap", expected `23514`.

# The bypass race: what the CHECK adds (26 Nov 2026)

`npm run race:bypass` (`scripts/bypass-race.ts`, `lib/bypass-race.ts`): 10 writers race one $3.00
budget, each spending $1.00 with the raw `UPDATE accounts SET balance_micro = balance_micro - …`
that any code path skipping `guard()` would send (a script, a hotfix, a new route), retrying only on
`40001`. Local Postgres 17, `SERIALIZABLE` as the app runs it.

| Schema and role                                                         | Committed | Refused     | Final balance | Overspend |
| ----------------------------------------------------------------------- | --------- | ----------- | ------------- | --------- |
| Before: schema at `202c4c8` (no CHECK), writers as the table owner      | 10        | 0           | −$7.00        | $7.00     |
| Before schema, writers as `stub_app` with today's grants                | 10        | 0           | −$7.00        | $7.00     |
| After: `npm run migrate` + `npm run db:app-role`, writers as `stub_app` | 3         | 7 × `23514` | $0.00         | $0.00     |
| After, writers as the table owner                                       | 3         | 7 × `23514` | $0.00         | $0.00     |

Measured 17:29:32 to 17:30:14 UTC. The second row is the point: the least-privilege role alone
does not stop the overspend, because the app must be able to write balances. The constraint does,
for every role, including the owner. The live clusters cannot reproduce the before rows any more,
because the CHECK is validated on both; the live before is the 09:10 UTC probe in section 1b
(`balance = -1` accepted as `admin`).

`test/local/db-guardrail.test.ts` asserts the after rows and the 5 `/proof` refusals as `stub_app`
on a real Postgres. CI's `db-proof` job runs it on `postgres:17` on every push and pull request.
Against the pre-fix schema with today's grants it fails for the right reason: the negative-balance
probe is `accepted`, and the race ends at `-7000000` micro-dollars instead of `0`.

# Before and after on Aurora DSQL itself (27 Nov 2026)

The bypass race above ran on local Postgres, because both live clusters already refuse it. To
measure it on DSQL, a temporary single-Region cluster was created in us-east-1, used, and deleted
the same hour. One cluster, one identity (`admin`, the role the old app used), one protocol; the
only thing that changes between the two columns is the schema.

1. Before: the schema from `202c4c8` (the last commit before the fix), applied by that commit's own
   `scripts/migrate.ts` from a worktree. It created `accounts` with no CHECK, then stopped at the
   same `ADD COLUMN` error described under "Problems hit".
2. `npm run race:bypass -- --as owner --runs 10 --out measurements/wa-review/dsql-race-before.json`
3. After: the current `npm run migrate` on the same cluster (adds the three CHECKs `NOT VALID`,
   validates with `ALTER TABLE ASYNC`; 46 s in all).
4. The same race again, `--out measurements/wa-review/dsql-race-after.json`.

Protocol, fixed for every run: 10 writers, a $3.00 budget, $1.00 each, each writer in its own
transaction retrying `40001` up to 25 times.

| Measure, 10 runs each, connected as `admin` | Before (no CHECK)       | After (CHECKs validated) |
| ------------------------------------------- | ----------------------- | ------------------------ |
| Writes committed per run                    | 10 in all 10 runs       | 3 in all 10 runs         |
| Writes refused per run                      | 0                       | 7, all `23514`           |
| OCC retries (`40001`) per run               | 45 in all 10 runs       | 24 in all 10 runs        |
| Final balance                               | -$7.00 in all 10 runs   | $0.00 in all 10 runs     |
| Money spent that was not in the budget      | $70.00 over the 10 runs | $0.00                    |

DSQL's OCC serialised all ten writers in both columns (45 = 9 + 8 + … + 1 retries). OCC decides the
order; it never decided whether a write was affordable. The CHECK does. Each run's per-writer
timeline (finish time, outcome, SQLSTATE, running balance) is in the two JSON files.
