import { listAccounts, listDenials, listEntries, listPolicies } from "../lib/data";
import { formatUsd, microToUsd } from "../lib/money";
import { SpendSimulator } from "../components/spend-simulator";
import { FreezeToggle, KillSwitch } from "../components/freeze-controls";
import { LiveRefresh } from "../components/live-refresh";
import { PolicyEditor, type PolicyView } from "../components/policy-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  org: "Organization",
  team: "Team",
  agent: "Agent",
  vendor: "Vendor",
};

const REASON_LABEL: Record<string, string> = {
  cap_exceeded: "Over budget",
  account_frozen: "Account frozen",
  per_txn_limit: "Over per-transaction cap",
  window_limit: "Over rolling-window cap",
  vendor_blocked: "Vendor blocked",
  vendor_not_allowed: "Vendor not allow-listed",
  needs_approval: "Needs human approval",
};

export default async function Dashboard() {
  const [accounts, entries, denials, policies] = await Promise.all([
    listAccounts(),
    listEntries(40),
    listDenials(20),
    listPolicies(),
  ]);

  const policyViews: PolicyView[] = policies.map((p) => ({
    id: p.id,
    accountId: p.accountId,
    accountName: p.accountName,
    label: p.label,
    enabled: p.enabled,
    limitUsd: p.limitMicro == null ? null : microToUsd(p.limitMicro),
    windowSeconds: p.windowSeconds,
    vendorAllow: p.vendorAllow,
    vendorBlock: p.vendorBlock,
    approvalUsd: p.approvalThresholdMicro == null ? null : microToUsd(p.approvalThresholdMicro),
  }));

  const org = accounts.find((a) => a.type === "org");
  const cap = org?.capMicro ?? 0n;
  const spent = accounts
    .filter((a) => a.type === "vendor")
    .reduce((sum, a) => sum + a.balanceMicro, 0n);
  const remaining = cap - spent;
  const pctSpent = cap > 0n ? Number((spent * 1000n) / cap) / 10 : 0;

  const budgets = accounts
    .filter((a) => a.type === "org" || a.type === "team" || a.type === "agent")
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const vendors = accounts
    .filter((a) => a.type === "vendor")
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));

  const grouped = {
    team: accounts.filter((a) => a.type === "team"),
    agent: accounts.filter((a) => a.type === "agent"),
    vendor: accounts.filter((a) => a.type === "vendor"),
  };

  const anyActive = accounts.some(
    (a) => a.type !== "vendor" && !a.frozen,
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold tracking-tight text-fg">stub</span>
            <span className="text-xs uppercase tracking-widest text-fg-mute">spend control plane</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
            One budget your agents can&apos;t break.
          </h1>
        </div>
        <LiveRefresh />
      </header>

      <section className="mt-8 rounded-xl border border-line bg-surface p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-fg-mute">
              Org guardrail
            </div>
            <div className="mt-1 text-sm text-fg-dim">{org?.name ?? "—"} · company-wide budget</div>
          </div>
          <div className="flex items-center gap-4">
            <KillSwitch anyActive={anyActive} />
            <div className="text-right">
              <div className="tabular text-3xl font-semibold text-fg">{formatUsd(remaining)}</div>
              <div className="text-xs text-fg-mute">remaining of {formatUsd(cap)}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-ink">
          <div
            className="h-full rounded-full bg-commit transition-[width] duration-700"
            style={{
              width: `${Math.min(pctSpent, 100)}%`,
              backgroundColor: pctSpent >= 100 ? "var(--color-deny)" : pctSpent >= 80 ? "var(--color-warn)" : "var(--color-commit)",
            }}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Stat label="Committed" value={formatUsd(spent)} />
          <Stat label="Burn" value={`${pctSpent.toFixed(1)}%`} />
          <Stat label="Ledger entries" value={String(entries.length)} />
          <Stat label="Breaches blocked" value={String(denials.length)} tone={denials.length ? "deny" : "default"} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-xl border border-line bg-surface p-6">
          <SectionTitle>Accounts</SectionTitle>
          <div className="mt-4 flex flex-col gap-5">
            {(["team", "agent", "vendor"] as const).map((type) => (
              <div key={type}>
                <div className="text-xs font-medium uppercase tracking-widest text-fg-mute">
                  {TYPE_LABEL[type]}s
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {grouped[type].map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between rounded-lg border bg-surface-2 px-3 py-2.5 ${
                        a.frozen ? "border-deny-dim" : "border-line"
                      }`}
                    >
                      <span className="text-sm text-fg">{a.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="tabular text-sm text-fg-dim">{formatUsd(a.balanceMicro)}</span>
                        {type !== "vendor" && <FreezeToggle accountId={a.id} frozen={a.frozen} />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-6">
          <SectionTitle>Simulate spend</SectionTitle>
          <p className="mt-1 text-sm text-fg-dim">
            Route a spend through the policy gate. Over-cap requests are denied and logged.
          </p>
          <div className="mt-4">
            <SpendSimulator budgets={budgets} vendors={vendors} />
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-line bg-surface p-6">
        <SectionTitle>Policies · the spend gate</SectionTitle>
        <p className="mt-1 text-sm text-fg-dim">
          Layered ceilings evaluated on every spend, inside the same transaction as the ledger
          write. A flat balance can&apos;t tell 50×$0.01 from 1×$2.40 — these can.
        </p>
        <div className="mt-4">
          <PolicyEditor policies={policyViews} budgets={budgets} vendors={vendors} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-6">
          <SectionTitle>Ledger · committed, hash-chained</SectionTitle>
          <div className="mt-4 flex flex-col divide-y divide-line">
            {entries.length === 0 && <Empty>No entries yet. Authorize a spend to populate the ledger.</Empty>}
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg">
                    {e.intent ?? "spend"} <span className="text-fg-mute">→ {e.accountName}</span>
                  </div>
                  <div className="tabular truncate text-xs text-fg-mute">{e.hash.slice(0, 16)}…</div>
                </div>
                <span
                  className={`tabular shrink-0 text-sm ${e.kind === "debit" ? "text-deny" : "text-commit"}`}
                >
                  {e.kind === "debit" ? "−" : "+"}
                  {formatUsd(e.amountMicro < 0n ? -e.amountMicro : e.amountMicro)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-6">
          <SectionTitle>Denials · overspend blocked</SectionTitle>
          <div className="mt-4 flex flex-col divide-y divide-line">
            {denials.length === 0 && <Empty>No denials. Every spend so far stayed within budget.</Empty>}
            {denials.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg">{d.intent ?? "spend"}</div>
                  <div className="text-xs text-deny">{REASON_LABEL[d.reason] ?? d.reason}</div>
                </div>
                <span className="tabular shrink-0 text-sm text-fg-dim">{formatUsd(d.attemptedMicro)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "deny" }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-mute">{label}</div>
      <div className={`tabular text-base ${tone === "deny" ? "text-deny" : "text-fg"}`}>{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-dim">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-sm text-fg-mute">{children}</div>;
}
