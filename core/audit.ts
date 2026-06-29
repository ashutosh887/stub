import { GENESIS_HASH, hashEntry } from "./hash";
import type { Entry } from "./store";

export interface ChainProblem {
  accountId: string;
  entryId: string;
  kind: "broken_link" | "bad_hash";
}

export function verifyChain(entries: Entry[]): ChainProblem[] {
  const lastHashByAccount = new Map<string, string>();
  const problems: ChainProblem[] = [];

  for (const entry of entries) {
    const expectedPrev = lastHashByAccount.get(entry.accountId) ?? GENESIS_HASH;
    if (entry.prevHash !== expectedPrev) {
      problems.push({ accountId: entry.accountId, entryId: entry.id, kind: "broken_link" });
    }

    const recomputed = hashEntry(entry.prevHash, {
      id: entry.id,
      transactionId: entry.transactionId,
      accountId: entry.accountId,
      kind: entry.kind,
      amountMicro: entry.amountMicro,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      userId: entry.userId,
      intent: entry.intent,
      costCenter: entry.costCenter,
      receipt: entry.receipt,
    });
    if (recomputed !== entry.hash) {
      problems.push({ accountId: entry.accountId, entryId: entry.id, kind: "bad_hash" });
    }

    lastHashByAccount.set(entry.accountId, entry.hash);
  }

  return problems;
}
