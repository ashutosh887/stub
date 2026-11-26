# Incident response

One playbook for each alarm, rule and refusal Stub has today. Every page goes to the SNS topic
`wa-stub-ops-alerts` in the Region that raised it (us-east-1 or us-east-2). Each playbook names
what fired, what to do in the first five minutes, how to confirm it, how to undo it, and who acts.

**Who.** One role exists: **the operator**, who holds the operator IAM principal, the Vercel
project and the `ADMIN_TOKEN`. The operator is incident lead, responder and approver. Escalation
outside Stub goes to AWS Support (a case from the console) for anything in AWS, and to Vercel
support for the hosting. Keep the operator's contact details in the SNS subscription and the
on-call tool, never in this repository.

**Before the first incident.** Confirm the topic's email subscription in both Regions (the link in
the AWS confirmation email). Until it is confirmed a page reaches nobody; read the rule and alarm
metrics in CloudWatch instead (`AWS/Events` `MatchedEvents` per rule, alarm history per alarm).

## Severity

| Level | Meaning                                                                     | Response                      |
| ----- | --------------------------------------------------------------------------- | ----------------------------- |
| SEV1  | The ledger, its backups or its integrity are at risk, or spends are failing | Start now, freeze if in doubt |
| SEV2  | The audit trail, threat detection or a security control was weakened        | Start within the hour         |
| SEV3  | Degraded behaviour with the invariant intact (contention, a failover)       | Same working day              |

## The freeze lever

`POST /api/freeze` with `{ "all": true }` (admin) makes every spend and reserve deny with
`account_frozen`; `{ "accountId": "…" }` freezes one budget and everything under it. Freezing never
loses money or breaks the ledger; it only refuses new spends. The dashboard's kill switch is the
same call.

Freeze **all** when any of these holds:

- the ledger's hash chain reports a problem (`GET /api/audit/verify`, `ok: false`);
- a balance `CHECK` refusal (`23514`) appears that the app did not cause on purpose;
- a cluster, its policy or its deletion protection changed and nobody on the operator's side did it;
- credentials that can write to the ledger may be exposed.

Freeze **one account** when a single budget's spend looks wrong (an agent looping, a velocity trip
repeating). Unfreeze (`"frozen": false`) only after the playbook's verify step passes.

## Playbooks

### OCC conflicts above normal (SEV3)

**What fired.** CloudWatch alarm `wa-dsql-occ-conflicts-<region>`: the cluster's `OccConflicts`
reached 50 or more in five minutes. A normal six-writer cross-Region race produces about ten.

**First 5 minutes.**

1. Open the alarm and note the Region and the five-minute sum.
2. Look in the Vercel runtime logs for `occ_exhausted` (a spend that used all its retries and
   answered 503) and for repeated `spend_settled` lines with high `conflicts`.
3. Find the hot budget: the account most `spend_settled` lines name, or the dashboard's burn rates.

**Verify.** Spends still settle as `committed` or `denied`, never as errors, and the balance stays
non-negative (`GET /api/accounts`). If `occ_exhausted` keeps appearing, callers are getting 503s.

**Rollback / fix.** Contention on one balance row is the cost of the guarantee, not a fault. If one
account is hot, shard it (`POST /api/accounts/shard`, admin); if an agent is looping, freeze that
account. Raising `OCC_MAX_RETRIES` trades latency for fewer 503s.

**Who.** The operator.

### Query timeouts (SEV1)

**What fired.** CloudWatch alarm `wa-dsql-query-timeouts-<region>`: at least one query hit the DSQL
transaction time limit in five minutes. A spend that times out is neither committed nor denied.

**First 5 minutes.**

1. Note the Region and time. Check `GET /api/health` (`db: up`, `region`, `latencyMs`).
2. Read Vercel logs around the time for `unhandled_error` and the route that raised it.
3. If timeouts continue, freeze the affected accounts so agents stop retrying blind.

**Verify.** `GET /api/audit/verify` returns `ok: true`; the affected spend either has a ledger entry
or a denial, never half of one (the transaction is atomic). Callers that got an error retry with the
same idempotency key and resolve to one entry.

**Rollback / fix.** Long transactions come from very large hierarchies or receipts; check the
request that timed out. If the cluster itself is unhealthy, see "Failover happened" and the AWS
Health dashboard.

**Who.** The operator; AWS Support if the cluster is degraded.

### Cluster deletion attempt or protection change (SEV1)

**What fired.** EventBridge rule `wa-dsql-destructive-calls`: a `DeleteCluster`, `UpdateCluster`,
`PutClusterPolicy` or `DeleteClusterPolicy` call on Aurora DSQL in this Region. Also the AWS Config
rule `wa-dsql-cluster-deletion-protection-enabled` turning `NON_COMPLIANT` (no page; check it
daily or after this rule fires).

**First 5 minutes.**

1. Open the event: `detail.userIdentity` (who), `detail.eventName`, `detail.requestParameters`,
   `detail.errorCode`. A `DeleteCluster` on a protected cluster fails with an error code; that
   is the control working.
2. If the caller is not the operator or the infrastructure pipeline, treat the caller's
   credentials as exposed: deactivate them now (IAM console), then freeze all.
3. Check the cluster: `aws dsql get-cluster --identifier <id>` shows `deletionProtectionEnabled`.

**Verify.** Run drift detection on both `stub-clusters` stacks; `IN_SYNC` means the protection and
the connect policy are as written in `infra/stub-clusters.yaml`.

**Rollback.**

- Protection turned off: `aws dsql update-cluster --identifier <id> --deletion-protection-enabled`,
  then drift detection again.
- Policy changed or deleted: apply `infra/stub-clusters.yaml` to that Region's stack through a
  change set (the policy is in the template), then drift detection.
- Cluster deleted: restore from AWS Backup (see Recovery) and repoint the app's endpoints.

**Who.** The operator.

### Audit trail stopped, narrowed or its bucket loosened (SEV2)

**What fired.** EventBridge rule `wa-audit-tampering` with source `aws.cloudtrail` (`StopLogging`,
`DeleteTrail`, `UpdateTrail`, `PutEventSelectors`) or `aws.s3` (`PutBucketPolicy`,
`DeleteBucketPolicy`, `PutBucketLifecycle`, `DeleteBucketLifecycle`, `PutBucketVersioning` on the
audit log bucket).

**First 5 minutes.**

1. Read `detail.userIdentity` and `detail.eventName`. A deploy of `stub-audit` from the pipeline
   or the operator also matches; check whether one ran at that minute.
2. `aws cloudtrail get-trail-status --name wa-stub-audit`: `IsLogging` must be true.
3. If the caller is unexpected, deactivate its credentials and freeze all: the attacker may be
   covering a ledger change.

**Verify.** `IsLogging: true`, `LatestDeliveryTime` within the last few minutes, log file validation
on (`aws cloudtrail describe-trails`), and drift detection on `stub-audit` is `IN_SYNC` (it checks
the bucket policy that denies log deletes, the lifecycle and the event selectors).

**Rollback.** `aws cloudtrail start-logging --name wa-stub-audit` restarts logging at once. For any
other change, apply `infra/stub-audit.yaml` to the `stub-audit` stack through a change set; the
template is the intended state. To check that no logs were altered during the gap:
`aws cloudtrail validate-logs --trail-arn <arn> --start-time <time before the event>`.

**Who.** The operator.

### GuardDuty disabled, changed or deleted (SEV2)

**What fired.** EventBridge rule `wa-audit-tampering` with source `aws.guardduty`
(`DeleteDetector` or any `UpdateDetector`).

**First 5 minutes.**

1. Read `detail.userIdentity` and `detail.requestParameters` (`enable`, `features`).
2. `aws guardduty list-detectors` and `get-detector`: `Status` must be `ENABLED`.

**Verify.** Drift detection on that Region's `stub-detection` stack is `IN_SYNC`.

**Rollback.**

- Disabled: `aws guardduty update-detector --detector-id <id> --enable`.
- A feature changed: put it back to the template's value with `update-detector --features`.
  (A CloudFormation update cannot do it: GuardDuty refuses a request that lists both
  `EKS_RUNTIME_MONITORING` and `RUNTIME_MONITORING`.)
- Deleted: `aws guardduty create-detector --enable --finding-publishing-frequency FIFTEEN_MINUTES`,
  then bring it under the stack by the release-and-import steps recorded in
  `measurements/wa-review/RESULTS.md` (F07, "GuardDuty drift").

**Who.** The operator.

### GuardDuty finding (SEV by finding)

**What fired.** EventBridge rule `wa-guardduty-findings`: a finding of severity 4 or higher.
Severity 7 and above is SEV1, 4 to 6.9 is SEV2.

**First 5 minutes.**

1. Read `detail.type`, `detail.severity`, `detail.resource` and the principal involved.
2. If the finding names a credential (for example `UnauthorizedAccess:IAMUser/…` or anomalous
   behaviour by a principal that can reach the ledger), deactivate it and freeze all.
3. Archive nothing yet.

**Verify.** CloudTrail event history for that principal over the finding's time window: which
calls it made, and whether any touched DSQL, IAM, CloudTrail, Backup or the audit bucket.

**Rollback.** Rotate the affected credential; if ledger rows may have been written by it, run
`GET /api/audit/verify` and compare with the last backup's fingerprint (see Recovery).

**Who.** The operator; AWS Support for help reading the finding.

### Failover happened (SEV3)

**What fired.** No alarm exists for this yet. The app logs `dsql_endpoint_switch` (with `from`,
`to`, `reason`) to the Vercel runtime logs when the primary endpoint cannot be reached, and
`GET /api/health` reports the active `region`.

**First 5 minutes.**

1. Confirm the switch: `GET /api/health` shows the peer Region.
2. Check the AWS Health dashboard and the primary cluster's status for the primary Region.
3. Do nothing to the data: both Regions are strongly consistent, so spends on the peer are as
   correct as on the primary (RPO 0).

**Verify.** Spends commit (`spend_settled` lines) and `GET /api/audit/verify` returns `ok: true`.

**Rollback.** None needed. After `DSQL_FAILBACK_AFTER_MS` (60 s) a background probe moves calls back
once the primary answers; a `dsql_endpoint_switch` back to the primary closes the incident.

**Measured.** Failover drill (`npm run drill:failover`), RESULTS.md F05: first spend committed on the
peer 14.87 s after the primary went dark with the default 10 s connect timeout, 7.59 s with a 3 s
timeout, 4.55 s when the primary's name stopped resolving.

**Who.** The operator.

### Budget balance check refused a write (SEV1)

**What fired.** No alarm exists for this yet. A transaction that would make a balance negative is
refused by the database with SQLSTATE `23514` (`accounts_balance_nonnegative` or
`account_shards_balance_nonnegative`). The route answers 500 and logs `unhandled_error` with the
constraint name in the message. The app checks the cap before writing, so this refusal means the
app's own check was bypassed or wrong.

**First 5 minutes.**

1. Freeze the account named in the log line (or all, if the account is unclear).
2. Keep the request id and the route from the log line.

**Verify.** `GET /api/accounts`: no negative balance (the constraint guarantees it). `GET
/api/audit/verify`: `ok: true`. The refused spend has no ledger entry.

**Rollback.** Nothing to undo in the data: the write never happened. Find why the app reached the
database with an overspend (a code change, a sharded account, a policy edit) and fix that before
unfreezing.

**Who.** The operator.

## Recovery

**Region loss.** Automatic: the app's failover pool moves to the peer endpoint (see "Failover
happened"). RPO 0, RTO about one connect timeout plus one peer connection, measured 4.55 to 14.87 s
(RESULTS.md F05).

**Logical damage or a deleted cluster.** Restore the latest AWS Backup recovery point (daily at
05:00 UTC, kept 35 days, vault-locked for 7) into a new cluster:

1. Freeze all, so nothing writes to the damaged cluster while you restore.
2. `aws backup list-recovery-points-by-backup-vault --backup-vault-name stub-ledger` and pick the
   last point before the damage.
3. `aws backup start-restore-job` on that point (leave `ResourceType` out; the point's own type is
   `DSQL`).
4. When the job completes, run `npm run ledger:fingerprint -- <new endpoint> <region>` and compare
   the counts and digests with the source (or with the last fingerprint taken).
5. Point `DSQL_ENDPOINT` (and the peer) at the restored cluster, redeploy, unfreeze.

**Measured.** Restore drill, RESULTS.md F03: the restore job took 2 min 8.7 s and the first query on
the restored cluster answered 2 min 19 s after the request; the fingerprint (row counts, every
entry hash, chain heads, sum of balances) matched the source exactly. RPO for logical damage is
24 h (the daily point).

**After any SEV1 or SEV2.** Run drift detection on all `stub-*` stacks, confirm every one is
`IN_SYNC`, and write what happened and what changed into the operator's incident log.
