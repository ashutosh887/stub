import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const LEDGER_TABLES = ["entries", "denials", "idempotency_keys"];

interface Grant {
  privileges: string[];
  tables: string[];
}

function grants(sql: string): Grant[] {
  return sql
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((statement) => {
      const match = statement.match(/^GRANT (.+) ON (.+) TO stub_app$/i);
      if (!match) throw new Error(`unexpected statement in db/app-role.sql: ${statement}`);
      const privileges = match[1]
        .replace(/\([^)]*\)/g, "")
        .split(",")
        .map((p) => p.trim().toUpperCase());
      const tables = match[2].split(",").map((t) => t.trim().toLowerCase());
      return { privileges, tables };
    });
}

describe("WA SEC03-BP01 (preventive): the app runs under a least-privilege identity", () => {
  it("connects as stub_app, never as admin, unless DSQL_USER says otherwise", async () => {
    const saved = process.env.DSQL_USER;
    delete process.env.DSQL_USER;
    vi.resetModules();
    try {
      const { dsql } = await import("@/config");
      expect(dsql.user).toBe("stub_app");
      expect(dsql.user).not.toBe(dsql.adminUser);
    } finally {
      if (saved !== undefined) process.env.DSQL_USER = saved;
      vi.resetModules();
    }
  });

  it("grants the database role no rewrite of the ledger and no DDL", () => {
    const all = grants(read("db/app-role.sql"));
    expect(all.length).toBeGreaterThan(0);
    for (const { privileges, tables } of all) {
      expect(privileges).not.toContain("ALL");
      expect(privileges).not.toContain("ALL PRIVILEGES");
      expect(privileges).not.toContain("TRUNCATE");
      expect(privileges).not.toContain("CREATE");
      for (const table of tables) {
        if (LEDGER_TABLES.includes(table)) {
          expect(privileges, `${table} must stay append-only`).not.toContain("UPDATE");
          expect(privileges, `${table} must stay append-only`).not.toContain("DELETE");
        }
        if (table === "accounts") {
          expect(privileges, "accounts are created by operators").not.toContain("INSERT");
          expect(privileges, "accounts are never deleted by the app").not.toContain("DELETE");
        }
      }
    }
  });

  it("lets the IAM role do nothing but dsql:DbConnect, assumed only from this project's production", () => {
    const template = read("infra/stub-app-role.yaml");
    const actions = new Set(
      [
        ...template.matchAll(/^\s*Action:\s*(\S+)\s*$/gm),
        ...template.matchAll(/"Action":\s*"([^"]+)"/g),
      ].map((m) => m[1]),
    );
    expect([...actions].sort()).toEqual(["dsql:DbConnect", "sts:AssumeRoleWithWebIdentity"]);
    expect(template).not.toMatch(/Action:\s*\[|Action:\s*$/m);
    expect(template).not.toMatch(/Resource:\s*["']?\*/);
    expect(template).toMatch(/:aud":\s*"https:\/\/vercel\.com\/\$\{VercelTeamSlug\}"/);
    expect(template).toMatch(
      /:sub":\s*"owner:\$\{VercelTeamSlug\}:project:\$\{VercelProject\}:environment:\$\{VercelEnvironment\}"/,
    );
    expect(template).not.toMatch(/StringLike/);
  });
});
