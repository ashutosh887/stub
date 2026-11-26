import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function resource(template: string, logicalId: string): string {
  const start = template.indexOf(`\n  ${logicalId}:\n`);
  if (start < 0) throw new Error(`${logicalId} is missing`);
  const rest = template.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("WA SEC01-BP05 (preventive): the controls live in code and stay switched on", () => {
  it("keeps every template under infra/ with a WA best-practice ID in its description", () => {
    const templates = readdirSync(new URL("../../infra/", import.meta.url)).filter((f) =>
      f.endsWith(".yaml"),
    );
    expect(templates.sort()).toEqual([
      "stub-app-role.yaml",
      "stub-audit.yaml",
      "stub-backup.yaml",
      "stub-clusters.yaml",
      "stub-deploy-role.yaml",
      "stub-detection.yaml",
    ]);
    for (const file of templates) {
      expect(read(`infra/${file}`), file).toMatch(/WA (SEC|REL)\d{2}-BP\d{2}/);
    }
  });

  it("REL09-BP05: the ledger cluster is protected and survives a stack delete", () => {
    const cluster = resource(read("infra/stub-clusters.yaml"), "LedgerCluster");
    expect(cluster).toContain("DeletionPolicy: Retain");
    expect(cluster).toContain("DeletionProtectionEnabled: true");
  });

  it("SEC05-BP01: the cluster policy denies connects outside the app role and operators", () => {
    const policy = resource(read("infra/stub-clusters.yaml"), "LedgerCluster");
    const deny = (action: string) =>
      `"Effect":"Deny","Principal":{"AWS":"*"},"Action":"${action}","Resource":"*"`;
    expect(policy).toContain(deny("dsql:DbConnect"));
    expect(policy).toContain(deny("dsql:DbConnectAdmin"));
    expect(policy).toMatch(/"dsql:DbConnectAdmin".*"aws:PrincipalArn":\[\$\{Operators\}\]/);
  });

  it("REL09-BP02, REL09-BP05: backups run daily into a locked vault and copy to the peer", () => {
    const template = read("infra/stub-backup.yaml");
    const vault = resource(template, "Vault");
    expect(vault).toContain("DeletionPolicy: Retain");
    expect(vault).toContain("LockConfiguration:");
    expect(resource(template, "Plan")).toContain("CopyActions:");
    expect(template).toMatch(/ScheduleExpression:\s*\n\s*Type: String\s*\n\s*Default: cron\(/);
  });

  it("SEC04-BP01: the trail covers every Region, validates its logs and refuses plain HTTP", () => {
    const template = read("infra/stub-audit.yaml");
    const trail = resource(template, "Trail");
    expect(trail).toContain("IsMultiRegionTrail: true");
    expect(trail).toContain("EnableLogFileValidation: true");
    expect(trail).toContain("IsLogging: true");
    expect(resource(template, "LogBucketPolicy")).toContain('aws:SecureTransport: "false"');
    expect(resource(template, "LogBucket")).toContain("LifecycleConfiguration:");
  });

  it("SEC04-BP02, REL06-BP01: detection, alarms and the deletion-protection rule stay on", () => {
    const template = read("infra/stub-detection.yaml");
    expect(resource(template, "Detector")).toContain("Enable: true");
    expect(template.match(/Type: AWS::CloudWatch::Alarm/g)?.length).toBeGreaterThanOrEqual(2);
    expect(resource(template, "AlertTopic")).toContain("KmsMasterKeyId:");
    expect(resource(template, "DeletionProtectionRule")).toContain(
      "DSQL_CLUSTER_DELETION_PROTECTION_ENABLED",
    );
  });

  it("SEC04-BP01: nobody deletes audit logs, and the detector outlives its stack", () => {
    const policy = resource(read("infra/stub-audit.yaml"), "LogBucketPolicy");
    expect(policy).toMatch(
      /Sid: DenyLogDeletes\s+Effect: Deny\s+Principal: "\*"\s+Action: s3:DeleteObject\*/,
    );
    const detector = resource(read("infra/stub-detection.yaml"), "Detector");
    expect(detector).toContain("DeletionPolicy: Retain");
  });

  it("SEC04-BP02: stopping or narrowing the trail, or touching GuardDuty, pages the ops topic", () => {
    const rule = resource(read("infra/stub-detection.yaml"), "AuditTamperingRule");
    for (const call of [
      "StopLogging",
      "DeleteTrail",
      "UpdateTrail",
      "PutEventSelectors",
      "DeleteDetector",
      "UpdateDetector",
      "DeleteBucketPolicy",
      "PutBucketLifecycle",
    ]) {
      expect(rule, call).toContain(call);
    }
    expect(rule).toContain("Arn: !Ref AlertTopic");
  });
});

describe("WA SEC02-BP02, REL08-BP01: the pipeline deploys with no stored key and a narrow role", () => {
  const template = read("infra/stub-deploy-role.yaml");
  const workflow = read(".github/workflows/infra.yml");

  it("trusts only GitHub's OIDC tokens for one repository and one branch", () => {
    const trust = resource(template, "DeployRole");
    expect(trust).toContain('"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"');
    expect(trust).toContain(
      '"token.actions.githubusercontent.com:sub": "repo:${GitHubRepository}:ref:refs/heads/${GitHubBranch}"',
    );
    expect(trust).not.toMatch(/StringLike/);
  });

  it("may only make change sets through the execution role, never on its own stack", () => {
    const deploy = resource(template, "DeployRole");
    expect(deploy).toMatch(
      /Action: cloudformation:CreateChangeSet[\s\S]*cloudformation:RoleArn: !GetAtt ExecutionRole.Arn/,
    );
    expect(deploy).not.toMatch(/stack\/stub-deploy-role/);
    expect(deploy).not.toMatch(/(Action:|-) cloudformation:(\*|DeleteStack\b|UpdateStack\b)/);
  });

  it("the execution role can never stop the audit, delete the ledger or delete logs", () => {
    const exec = resource(template, "ExecutionRole");
    const deny = exec.slice(exec.indexOf("Sid: NeverStopTheAuditOrLoseTheLedger"));
    expect(deny).toMatch(/^Sid: NeverStopTheAuditOrLoseTheLedger\s+Effect: Deny/);
    for (const action of [
      "cloudtrail:StopLogging",
      "cloudtrail:DeleteTrail",
      "dsql:DeleteCluster",
      "backup:DeleteRecoveryPoint",
      "guardduty:DeleteDetector",
      "s3:DeleteObject*",
      "kms:ScheduleKeyDeletion",
    ]) {
      expect(deny, action).toContain(`- ${action}`);
    }
    expect(exec).not.toMatch(/Action: "\*"|- "\*"$|iam:\*/m);
  });

  it("the workflow assumes the role over OIDC, stores no key, and deploys every stack the role names", () => {
    expect(workflow).toContain("role-to-assume: ${{ vars.AWS_INFRA_DEPLOY_ROLE_ARN }}");
    expect(workflow).not.toMatch(
      /aws-access-key-id|aws-secret-access-key|AWS_SECRET|AWS_ACCESS_KEY/i,
    );
    expect(workflow).toMatch(/id-token: write/);
    const named = [...resource(template, "DeployRole").matchAll(/stack\/([a-z-]+)\/\*/g)].map(
      (m) => m[1],
    );
    for (const stack of new Set(named)) {
      expect(workflow, stack).toContain(`stack: ${stack},`);
    }
    for (const file of readdirSync(new URL("../../infra/", import.meta.url))) {
      if (file !== "stub-deploy-role.yaml") expect(workflow, file).toContain(`template: ${file}`);
    }
    expect(workflow).not.toContain("template: stub-deploy-role.yaml");
  });
});
