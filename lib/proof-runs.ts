import { randomUUID } from "node:crypto";
import type { ProofReport, ProofTally } from "@/lib/proof";

export interface TallyClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

const INSERT = `INSERT INTO proof_runs (id, ran_at, region, statements, refused, accepted)
  VALUES ($1, $2, $3, $4, $5, $6)`;

const TALLY = `SELECT count(*) AS runs,
  coalesce(sum(statements), 0) AS statements,
  coalesce(sum(refused), 0) AS refused,
  coalesce(sum(accepted), 0) AS accepted,
  min(ran_at) AS since
  FROM proof_runs`;

export async function recordRun(client: TallyClient, report: ProofReport): Promise<void> {
  if (!report.ran) return;
  const count = (outcome: string) => report.probes.filter((p) => p.outcome === outcome).length;
  await client.query(INSERT, [
    randomUUID(),
    report.at,
    report.region,
    report.probes.length,
    count("refused"),
    count("accepted"),
  ]);
}

export async function readTally(client: TallyClient): Promise<ProofTally | null> {
  const { rows } = await client.query(TALLY);
  const row = rows[0];
  if (!row) return null;
  const runs = Number(row.runs);
  if (!Number.isFinite(runs) || runs === 0 || !row.since) return null;
  return {
    runs,
    statements: Number(row.statements),
    refused: Number(row.refused),
    accepted: Number(row.accepted),
    since: new Date(row.since as string | Date).toISOString(),
  };
}
