# Resilience drill and SQL audit logging (27 Nov 2026 IST, 26 Nov UTC)

Two changes, both through CloudFormation in `infra/`: an AWS FIS experiment template that cuts
connections to the primary Region's cluster (REL12-BP05), and Aurora DSQL audit logging to a locked
S3 bucket in each Region (SEC04-BP01). The drill itself has not been run yet (see "Failover drill").
While proving the audit log, I deleted a production ledger entry by mistake; it was restored from
backup 4 min 34 s later (see "Incident"). Times are UTC. Account IDs, cluster IDs and endpoints are
left out on purpose.

## What was deployed

Docs checked first (AWS FIS actions reference, Aurora DSQL user guide, CloudWatch Logs vended
logs, the AWS Database Blog post on DSQL audit logs):

- `aws:dsql:cluster-connection-failure`: resource type `aws:dsql:cluster`, parameters `duration`
  (ISO 8601, 1 minute to 12 hours) and `percentage` (1 to 100), permissions `dsql:InjectError`,
  `dsql:GetCluster`, `tag:GetResources`. `GetAction` in us-east-1 describes the percentage as "of
  connection attempts", target key `Clusters`. Condition keys `dsql:FisActionId` (String) and
  `dsql:FisTargetArns` (ArrayOfARN) are in the service authorization reference. The docs do not say
  which error a client sees.
- Audit logging has two halves. Where records go is a CloudWatch Logs vended log delivery
  (`AWS::Logs::DeliverySource` with log type `AUDIT_LOGS`, `AWS::Logs::DeliveryDestination`,
  `AWS::Logs::Delivery`), one per Regional cluster, and CloudFormation supports all three. What is
  recorded is set in SQL by `admin` or a member of `pg_dsql_audit_admin` (`ALTER SYSTEM SET
dsql_audit.log`, `sys.set_audit_config`), shared by both peers, and refused until every Region has
  a delivery source. Creating a delivery source or changing the baseline can give each open session
  one `OC002` (SQLSTATE `40001`) on its next statement. Statements that fail before they run
  (syntax errors) have no record; statements of a rolled-back transaction do.

| Stack (Region)                  | Change set (all reviewed before execute)                                                                                                                        | Result                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `stub-deploy-role` (us-east-1)  | `Modify` `ExecutionRole` (new permissions below), `Modify` `DeployRole` (dynamic: it reads the execution role's ARN, which did not change)                      | 19:19 `UPDATE_COMPLETE` |
| `stub-clusters` (us-east-2)     | `Add` S3 bucket, bucket policy, delivery source, destination, delivery                                                                                          | 19:20:27 to 19:20:53    |
| `stub-clusters` (us-east-1)     | the same five, plus `Add` `AWS::IAM::Role` and `AWS::FIS::ExperimentTemplate` (`FaultInjectionDrill=enabled`)                                                   | 19:21:47 to 19:22:23    |
| `stub-detection` (both Regions) | `Modify` `AuditTamperingRule` only: `DeleteDelivery`, `DeleteDeliverySource`, `DeleteDeliveryDestination`, `UpdateDeliveryConfiguration` now page the ops topic | 19:24 to 19:25          |
| Every change set                | no `Remove`, no `Replacement`; `LedgerCluster` untouched                                                                                                        |                         |
| After                           | termination protection on 5 of 5 changed stacks; drift `IN_SYNC` on 5 of 5 (every resource); deployed template SHA-256 equals the file in `infra/` for 5 of 5   |                         |

`stub-clusters` uses the stack's service role (`stub-infra-cfn-exec`), so the pipeline can keep
deploying it. Before the cluster stacks I simulated the execution role (34 cases, every result as
designed): allowed to create and configure buckets named `stub-dsql-audit-<account>-*` (including
Object Lock), the delivery resources, `dsql:AllowVendedLogDeliveryForResource`, FIS templates, and
roles named `stub-fis-*` passed only to `fis.amazonaws.com`; denied `s3:GetObject` and every delete
on the audit objects, `s3:BypassGovernanceRetention`, `logs:DeleteDelivery`,
`logs:DeleteDeliverySource`, `fis:StartExperiment`, `dsql:InjectError`, Object Lock changes on any
other bucket, and roles outside the two prefixes. The old blanket deny on
`s3:PutBucketObjectLockConfiguration` would have stopped the role from creating a locked bucket, so
it now uses `NotResource` for the SQL audit buckets only.

The audit bucket (one per Region, logs stay in their Region): SSE-S3, versioning, all public access
blocked, bucket owner enforced, TLS only, Object Lock in governance mode with a 90-day default
retention, lifecycle expiry at 90 days (noncurrent versions 1 day later), and a bucket policy that
denies `s3:DeleteObject*` and `s3:BypassGovernanceRetention` to every principal, the same pattern as
the CloudTrail bucket. The policy also carries the `delivery.logs.amazonaws.com` statements, so
`CreateDelivery` had nothing to add: read back after delivery, the policy still has exactly the four
statements in the template. The bucket and the three delivery resources have `DeletionPolicy:
Retain`. A governance lock was chosen over compliance because compliance can never be undone;
with the bucket policy denying the bypass permission, removing a file needs a bucket policy change
first, which pages through `wa-audit-tampering`.

The drill role trusts only `fis.amazonaws.com` for experiments in this account and Region, and may
call `dsql:InjectError` only with `dsql:FisActionId = aws:dsql:cluster-connection-failure` and every
`dsql:FisTargetArns` equal to the primary cluster's ARN (with a `Null` check, so an empty list does
not pass); `dsql:GetCluster` only on that cluster; `tag:GetResources` (no resource-level support).
The template: target the primary cluster by ARN, 100 percent, `PT2M`, single account, fail on an
empty target, tag `Name=stub-dsql-primary-connection-failure`.

No stop condition alarm. The harm the drill could do shows up in the app's own errors on Vercel,
which CloudWatch does not see; the DSQL metrics in us-east-1 are the very thing the fault drives,
and a stop condition must be an alarm in the experiment's Region. The fault is bounded at 2 minutes
and `aws fis stop-experiment` ends it at once.

`test/invariant/infrastructure.test.ts` gained two tests (14 now): the audit bucket stays locked,
versioned, private and undeletable with `AUDIT_LOGS` delivery retained; the drill role keeps both
FIS conditions and no wildcard action, and the template targets only its own cluster for 2 minutes.
The existing tests now also require the tamper rule to watch the delivery deletes and the execution
role to be denied them, the governance bypass and `StartExperiment`. `cfn-lint infra/*.yaml` (1.46):
0 findings; the execution role carries `ignore_checks: [W3037]` because cfn-lint's action list does
not yet know `AllowVendedLogDeliveryForResource` in either `dsql` or `logs`. `npm run verify`: 21
files, 175 tests passed.

## Audit logging: proof

The baseline, set once as `admin` (it applies to every role, including `stub_app` and roles made
later), at 19:44:08:

```sql
ALTER SYSTEM SET dsql_audit.log = 'ddl,role,write';
```

`SELECT * FROM sys.audit_delivery_status()` returned `has_delivery = t` for us-east-1 and
us-east-2; `SHOW dsql_audit.log` on a new connection to each Region returned `ddl,role,write`.

The refused statement: as `admin`, on the primary, inside `BEGIN … ROLLBACK`,
`UPDATE accounts SET balance_micro = -1 WHERE id = <the drill-stress budget>`. The database refused
it at 19:44:48.590 (client clock) with `23514 accounts_balance_nonnegative`. The record arrived in
the us-east-1 bucket at about 19:48:39 (the first file, under `AWSLogs/<account>/dsql/us-east-1/
2026/11/26/19/`), 3 min 50 s later:

| Field             | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| `event_timestamp` | 19:44:48.718                                                                |
| `class`/`command` | `WRITE` / `UPDATE`                                                          |
| `session_user`    | `admin`                                                                     |
| `iam_arn`         | the operator's IAM user                                                     |
| `statement_text`  | `UPDATE accounts SET balance_micro = -1 WHERE id = '<drill-stress budget>'` |

The same file held the `ALTER SYSTEM` (class `DDL`, 19:44:11.263); changes to audit settings are
always recorded. What a record does not carry: the outcome. There is no SQLSTATE or error field, so
a refused statement and an accepted one look the same; pair the log with the app's own response or
with CDC (`transaction_id` matches CDC's `source.txId`, and a refused or rolled-back statement has
no CDC record).

Not proven: a statement refused by `stub_app` through the app (`POST /api/proof`). The site
returned Vercel's platform challenge (403, `x-vercel-mitigated: challenge`) to every request from
19:44 on, and the lead asked for no more requests. Since the baseline covers every role, the next
`/proof` run should appear as `stub_app` records with the app role's ARN; worth one look in the
bucket after it.

Volume and cost: the first 8 records came to 2 files, 1,264 bytes compressed. Vended log delivery to
S3 is $0.25 per GB (us-east-1, first 10 TB), S3 Standard $0.023 per GB-month, and audit adds DSQL
DPU usage that the docs price but do not size. At this ledger's traffic (a few hundred spends a
month, about ten audited writes each, under 1 KB per record) that is a few MB a month: under $0.01
for delivery and storage. The bound is the PUT count, at most one file per 5 minutes per Region,
about 17,300 PUTs a month, $0.09. Estimate: under $0.15 a month in total.

## Failover drill (not run yet)

Planned at night for little traffic. Not started: the 403 challenge above began during the wait for
the lead's deploy, and the lead then asked me to hold. The template stays in place; it costs nothing
idle and $0.20 per run (FIS bills $0.10 per action-minute, 2 minutes).

Re-run, as an operator in us-east-1:

```sh
aws fis start-experiment --region us-east-1 \
  --experiment-template-id "$(aws fis list-experiment-templates --region us-east-1 \
    --query "experimentTemplates[?tags.Name=='stub-dsql-primary-connection-failure'].id" \
    --output text)"
# stop early:
aws fis stop-experiment --region us-east-1 --id <experiment id printed above>
```

What to measure, and what reading the code says to expect:

- `GET /api/health` every 500 ms (`db`, `region`), and a committed spend every second through the
  failover pool: `POST /api/reserve` then `POST /api/release` with the admin cookie on the
  `drill-stress` budget ($0.01, released at once). Not `/api/stress` or `/api/incident`: both build
  their own pool on the primary with `createDriverPool`, not `getPool()`, so they cannot fail over
  and will fail for the whole window. That is a gap in its own right for a drill page.
- A local run of `db/failover.ts` as `admin` beside it: a fresh connection to the primary each
  second (logs the raw `code`, `severity`, `message`), one long-lived connection (does the fault
  close open sessions, or only refuse new ones?), and a `FailoverPool` (when does it switch?).
- `isEndpointFailure` switches on network codes, connect timeouts, "Connection terminated" and
  SQLSTATE classes `08`, `28`, `57P0`. If the injected failure is an authentication-time PostgreSQL
  error with another class (for example `53xxx` or `XX000`), the pool will not switch: stop the
  experiment and add that code. Because the action refuses "connection attempts", warm Vercel
  functions holding pooled connections (`DSQL_MAX_LIFETIME_SECONDS` 600) may keep working on the
  primary, and only cold starts and new pool connections would hit the fault.

## Incident: a production ledger entry deleted by the reviewer, and restored

Severity: one immutable ledger row (`entries`) removed from production for 4 min 34 s; one empty
table created and dropped. No balance or account row changed. Cause: my command.

### Timeline (UTC)

| Time         | Event                                                                                                                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19:48:58.5   | As `admin`, from my machine, on the us-east-1 cluster, I sent, one statement per call on a one-connection pool: `BEGIN`; `SET LOCAL ROLE stub_app`; `SELECT current_user`; `DELETE FROM entries WHERE id = (SELECT id FROM entries ORDER BY id LIMIT 1)`; `ROLLBACK`. The intent: a `42501` refusal as `stub_app` for the audit proof. |
| 19:49:01.3   | `SET LOCAL ROLE stub_app` failed: `42501 permission denied to set role "stub_app"`.                                                                                                                                                                                                                                                    |
| 19:49:01.6   | `SELECT current_user` answered `admin`. On PostgreSQL this would have failed with `25P02` (transaction aborted); on DSQL it ran.                                                                                                                                                                                                       |
| 19:49:03.663 | The `DELETE` ran as `admin`, outside any transaction, and committed: 1 row. `ROLLBACK` then had nothing to roll back.                                                                                                                                                                                                                  |
| 19:49:04.2   | The same pattern again with `CREATE TABLE stub_audit_probe (id INT PRIMARY KEY)`: the table was created (19:49:06.725).                                                                                                                                                                                                                |
| 19:49:20     | Detected: `to_regclass('public.stub_audit_probe')` returned the table, so the `ROLLBACK`s had undone nothing.                                                                                                                                                                                                                          |
| 19:49:39     | Dropped `stub_audit_probe` (0 rows).                                                                                                                                                                                                                                                                                                   |
| 19:49:50     | Reported to the lead, with the repair plan.                                                                                                                                                                                                                                                                                            |
| 19:49:59     | Located: one entry's `prev_hash` pointed at a hash no row had any more: a credit on the `Data API (x402)` vendor account, created 29 Jun 2026.                                                                                                                                                                                         |
| 19:50:31.5   | `StartRestoreJob` on the latest completed recovery point of the us-east-1 cluster (26 Nov 09:34) into a new temporary cluster.                                                                                                                                                                                                         |
| 19:51:09     | `ledger:fingerprint` on production: 55 entries, `chainProblems: 1`.                                                                                                                                                                                                                                                                    |
| 19:52:36.7   | Restore complete (2 min 5 s). Tagged `purpose=wa-restore-temp`; deletion protection was on by default and was turned off on the temporary cluster only.                                                                                                                                                                                |
| 19:53:10     | Compared: exactly one `entries` id in the restore and not in production, the row above. 26 ids in production and not in the restore, all newer than the backup.                                                                                                                                                                        |
| 19:53:37.8   | Re-inserted the row as `admin`, in one transaction, with the explicit column list from `information_schema` and every value cast from the restored row's text form. `md5(row::text)` on production equals the restored row's: match.                                                                                                   |
| 19:53:49     | `ledger:fingerprint` on production: 56 entries, `chainProblems: 0`, balance total and chain-head digest unchanged from 19:51:09.                                                                                                                                                                                                       |
| 19:54:03     | `DeleteCluster` on the temporary cluster (tag checked first); `GetCluster` answered `ResourceNotFoundException` by 19:56:32.                                                                                                                                                                                                           |

Entries: 56 before the delete, 55 after it, 56 after the restore. For the affected account the
restore had 7 entries and production 19 after the delete: 6 shared plus 13 written between 17:22 and
18:21 today, after the backup. That also explains the account's other differences: balance 0.82 USD
in the restore and 6.02 USD in production, and a different chain head. The delete never touched
`accounts`, so balances and heads were the same before and after the repair.

### Root cause

In Aurora DSQL a statement that fails inside an explicit transaction ends that transaction. The
next statement on the connection runs on its own, in autocommit. PostgreSQL instead keeps the
transaction open and refuses everything until `ROLLBACK` (`25P02`), which is what I assumed. The
audit log shows it: the `DELETE` and the `CREATE TABLE` each carry their own `transaction_id` with
`statement_id` 1, not the transaction of the `BEGIN`.

The trigger was mine: I sent a destructive statement to production as the owner of the table,
relying on a `ROLLBACK` to make it harmless, after a step whose failure I had not checked. `admin`
cannot `SET ROLE stub_app` (it is not a member), so the statement ran with full rights.

### Detection

By chance, 17 s later, from the `CREATE TABLE` that should not have persisted. Then two controls
built earlier caught it on their own: the hash chain (`verifyChain`, `chainProblems: 1`; the `/audit`
page would have shown the break), and the new SQL audit log, whose 19:49:03.663 record names the
statement, the `admin` role and the operator's IAM user:

```
19:49:03.663 us-east-1 admin <operator IAM user> WRITE DELETE
  DELETE FROM entries WHERE id = (SELECT id FROM entries ORDER BY id LIMIT 1)
```

### Recovery

Restore into a new cluster, read the one missing row, insert it once, check the digest and the
chain. 4 min 34 s from the delete to the row back; the restore itself 2 min 5 s. It worked because
the row predated the only recovery point (09:34). A row written after it would have been gone for
good: there was no daily point yet, and there is no point-in-time recovery.

### Lessons

- On DSQL, `BEGIN … ROLLBACK` protects only the first statement that fails. Any script that sends
  more than one statement inside a transaction must stop at the first error, not carry on to
  `ROLLBACK`.
- No ad-hoc writes to production as `admin`, even inside a transaction meant to be rolled back.
  Refusal probes run as the role being tested (`stub_app`), or on a restored copy.
- The audit log, the hash chain and AWS Backup each did their part. The gap is the recovery point
  objective for logical damage: 24 h at best, and here the only point was 10 h old.

### Do `lib/proof.ts` and `.github/actions/db-guardrail/runner.mjs` have the same hole? (read only)

No. In both, each probe runs as `BEGIN`, the probe, `ROLLBACK`, and nothing that can fail sits
between `BEGIN` and the probe, so a failed earlier statement can never leave the probe in
autocommit. A probe that fails ends its own transaction, and the `ROLLBACK` after it is a no-op. A
probe that succeeds is still inside its `BEGIN` and is rolled back. Both refuse to run unless the
connection is a non-owner (`lib/proof.ts`: `current_user` must be `stub_app` and must not own
`entries`; the runner: not a superuser and owning none of the probed tables, unless
`require-non-owner: false`). The runner also refuses transaction-control statements in a probe and
sends each probe in extended query mode, which allows one statement only. Two residual points: if
`BEGIN` itself fails, `lib/proof.ts` throws before the probe (safe); if `ROLLBACK` fails after an
accepted probe, `lib/proof.ts` swallows the error and releases the connection to the pool, and the
runner throws and ends its client. Neither changes the result here, since the probes are refused.

## Still open

- Run the FIS drill once the lead allows it, with the measurements above; if the pool does not
  switch on the injected code, add it to `isEndpointFailure` and to `test/invariant/failover.test.ts`,
  deploy, and run again.
- Find the first `stub_app` record from a real `/proof` run in the audit bucket.
- `/api/stress` and `/api/incident` do not use the failover pool.
- Who may change audit settings: any IAM principal with `dsql:DbConnectAdmin` (the operators). A
  dedicated audit role (`pg_dsql_audit_admin`) and a `DbConnectAdmin` break-glass role would
  separate the two duties; not done.
- The `stub-infra-cfn-exec` role may write the inline policy of roles named `stub-fis-*`, as it may
  for `stub-app` (the residual risk recorded under F07); branch protection on `main` covers both.
