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
});
