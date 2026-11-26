import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Connectable } from "@/db/client";
import { beginStatement } from "@/db/pg-store";
import { formatUsd } from "@/lib/money";

export const BALANCE_CHECK = "accounts_balance_nonnegative";

export interface RaceOptions {
  writers: number;
  balanceMicro: bigint;
  amountMicro: bigint;
  maxRetries: number;
}

export interface RaceReport {
  connectedAs: string;
  checkConstraint: boolean;
  writers: number;
  startUsd: string;
  amountUsd: string;
  affordable: number;
  committed: number;
  refused: Record<string, number>;
  retries: number;
  finalMicro: string;
  finalUsd: string;
  overspendUsd: string;
  timeline: RaceStep[];
  at: string;
}

export interface RaceStep {
  ms: number;
  committed: boolean;
  code: string | null;
  balanceUsd: string;
}

interface WriterResult {
  committed: boolean;
  code: string | null;
  retries: number;
  finishedAt: number;
}

const SPEND = `UPDATE accounts SET balance_micro = balance_micro - $2 WHERE id = $1`;

async function write(
  client: PoolClient,
  accountId: string,
  amountMicro: bigint,
  maxRetries: number,
): Promise<WriterResult> {
  for (let retries = 0; ; retries++) {
    try {
      await client.query(beginStatement());
      await client.query(SPEND, [accountId, amountMicro.toString()]);
      await client.query("COMMIT");
      return { committed: true, code: null, retries, finishedAt: performance.now() };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (err as { code?: string }).code ?? "unknown";
      if (code !== "40001" || retries >= maxRetries) {
        return { committed: false, code, retries, finishedAt: performance.now() };
      }
    }
  }
}

export async function hasBalanceCheck(owner: Connectable): Promise<boolean> {
  const { rows } = await owner.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [
    BALANCE_CHECK,
  ]);
  return rows.length > 0;
}

export async function runBypassRace(
  owner: Connectable,
  writer: Connectable,
  options: RaceOptions,
): Promise<RaceReport> {
  const { writers, balanceMicro, amountMicro, maxRetries } = options;
  const accountId = randomUUID();
  const at = new Date().toISOString();
  await owner.query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro)
     VALUES ($1, 'agent', NULL, 'bypass-race', $2, $2)`,
    [accountId, balanceMicro.toString()],
  );
  const clients: PoolClient[] = [];
  try {
    for (let i = 0; i < writers; i++) clients.push(await writer.connect());
    const who = await clients[0].query<{ role: string }>(`SELECT current_user AS role`);
    const started = performance.now();
    const results = await Promise.all(
      clients.map((client) => write(client, accountId, amountMicro, maxRetries)),
    );
    const { rows } = await owner.query<{ balance_micro: string }>(
      `SELECT balance_micro FROM accounts WHERE id = $1`,
      [accountId],
    );
    const final = BigInt(rows[0].balance_micro);
    const refused: Record<string, number> = {};
    for (const r of results) if (r.code) refused[r.code] = (refused[r.code] ?? 0) + 1;
    let running = balanceMicro;
    const timeline = [...results]
      .sort((a, b) => a.finishedAt - b.finishedAt)
      .map((r) => {
        if (r.committed) running -= amountMicro;
        return {
          ms: Math.round(r.finishedAt - started),
          committed: r.committed,
          code: r.code,
          balanceUsd: formatUsd(running),
        };
      });
    return {
      connectedAs: who.rows[0].role,
      checkConstraint: await hasBalanceCheck(owner),
      writers,
      startUsd: formatUsd(balanceMicro),
      amountUsd: formatUsd(amountMicro),
      affordable: Number(balanceMicro / amountMicro),
      committed: results.filter((r) => r.committed).length,
      refused,
      retries: results.reduce((sum, r) => sum + r.retries, 0),
      finalMicro: final.toString(),
      finalUsd: formatUsd(final),
      overspendUsd: formatUsd(final < 0n ? -final : 0n),
      timeline,
      at,
    };
  } finally {
    for (const client of clients) client.release();
    await owner.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
  }
}
