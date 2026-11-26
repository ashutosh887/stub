import { describe, expect, it } from "vitest";
import { PROOF_PROBES, outcomeOf, redact, runProof, type ProofClient } from "@/lib/proof";

type Answer =
  { rows?: unknown[]; rowCount?: number | null } | { error: { code?: string; message: string } };

function fakeClient(role: string, owns: boolean, answers: Record<string, Answer>) {
  const sent: string[] = [];
  const client: ProofClient = {
    async query(text) {
      sent.push(text);
      if (text.startsWith("SELECT current_user")) return { rows: [{ role, owns }], rowCount: 1 };
      if (text === "BEGIN" || text === "ROLLBACK") return { rows: [], rowCount: null };
      const answer = answers[text];
      if (!answer) throw new Error(`unexpected statement: ${text}`);
      if ("error" in answer) throw Object.assign(new Error(answer.error.message), answer.error);
      return { rows: answer.rows ?? [], rowCount: answer.rowCount ?? null };
    },
  };
  return { client, sent };
}

const [negative, rewrite, remove, create, drop] = PROOF_PROBES;

const REFUSALS: Record<string, Answer> = {
  [negative.sql]: {
    error: {
      code: "23514",
      message:
        'new row for relation "accounts" violates check constraint "accounts_balance_nonnegative"',
    },
  },
  [rewrite.sql]: { error: { code: "42501", message: "permission denied for table entries" } },
  [remove.sql]: { error: { code: "42501", message: "permission denied for table entries" } },
  [create.sql]: { error: { code: "42501", message: "permission denied for schema public" } },
  [drop.sql]: { error: { code: "42501", message: "must be owner of table entries" } },
};

describe("the public proof never runs as admin and never persists", () => {
  it("sends the five probes the claim rests on, with the codes RESULTS.md measured", () => {
    expect(PROOF_PROBES.map((p) => p.expected)).toEqual([
      "23514",
      "42501",
      "42501",
      "42501",
      "42501",
    ]);
  });

  it("refuses to probe when connected as admin, sending nothing but the identity check", async () => {
    const { client, sent } = fakeClient("admin", true, {});
    const report = await runProof(client, "us-east-1 (primary)");
    expect(report.ran).toBe(false);
    expect(report.reason).toBe("not run: connected as admin");
    expect(report.probes).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("refuses to probe when the app role owns the ledger tables", async () => {
    const { client, sent } = fakeClient("stub_app", true, {});
    const report = await runProof(client, "us-east-1 (primary)");
    expect(report.ran).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("wraps every probe in its own BEGIN … ROLLBACK and maps each refusal", async () => {
    const { client, sent } = fakeClient("stub_app", false, REFUSALS);
    const report = await runProof(client, "us-east-2 (peer)");
    expect(report.ran).toBe(true);
    expect(report.region).toBe("us-east-2 (peer)");
    expect(report.probes.map((p) => [p.outcome, p.sqlstate])).toEqual([
      ["refused", "23514"],
      ["refused", "42501"],
      ["refused", "42501"],
      ["refused", "42501"],
      ["refused", "42501"],
    ]);
    expect(sent.slice(1)).toEqual(PROOF_PROBES.flatMap((p) => ["BEGIN", p.sql, "ROLLBACK"]));
    expect(sent).not.toContain("COMMIT");
  });

  it("shows an accepted statement plainly and still rolls it back", async () => {
    const { client, sent } = fakeClient("stub_app", false, {
      ...REFUSALS,
      [rewrite.sql]: { rowCount: 1 },
      [drop.sql]: { rowCount: null },
    });
    const report = await runProof(client, "us-east-1 (primary)");
    const byId = Object.fromEntries(report.probes.map((p) => [p.id, p]));
    expect(byId["rewrite-entry"].outcome).toBe("accepted");
    expect(byId["rewrite-entry"].message).toMatch(/ACCEPTED/);
    expect(byId["drop-entries"].outcome).toBe("accepted");
    const afterDrop = sent[sent.indexOf(drop.sql) + 1];
    expect(afterDrop).toBe("ROLLBACK");
  });

  it("tells a different SQLSTATE, a statement that matched nothing and a dropped connection apart", () => {
    expect(outcomeOf(negative, { error: { code: "40001", message: "conflict" } }).outcome).toBe(
      "refused-differently",
    );
    expect(outcomeOf(negative, { rows: 0 }).outcome).toBe("no-row");
    expect(outcomeOf(negative, { error: { code: "ECONNRESET", message: "reset" } })).toMatchObject({
      outcome: "error",
      sqlstate: null,
    });
  });

  it("strips account ids, cluster ids, endpoints and ARNs from what the database says", () => {
    const text = redact(
      "denied for arn:aws:iam::123456789012:role/x on abcdefghijklmnopqrstuvwxyz.dsql.us-east-1.on.aws in 123456789012 cluster abcdefghijklmnopqrstuvwx12",
    );
    expect(text).not.toMatch(/\d{12}/);
    expect(text).not.toMatch(/[a-z0-9]{26}/);
    expect(text).not.toMatch(/on\.aws|arn:aws/);
  });
});
