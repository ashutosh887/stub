import {
  type AccountRow,
  listAccounts,
  listAgents,
  listDenials,
  listEntries,
  listFleetSpend,
  listPolicies,
} from "@/lib/data";
import { formatUsd, microToUsd } from "@/lib/money";
import { forecast } from "@/core/forecast";
import { SpendSimulator } from "@/components/spend-simulator";
import { FreezeToggle, KillSwitch } from "@/components/freeze-controls";
import { LiveRefresh } from "@/components/live-refresh";
import { PolicyEditor, type PolicyView } from "@/components/policy-editor";
import { NlQuery } from "@/components/nl-query";
import { AgentRegistry } from "@/components/agent-registry";
import { ConsoleGate } from "@/components/console-gate";
import { ConsoleShell } from "@/components/app-tabs";
import { StartHere } from "@/components/start-here";
import { StressTest } from "@/components/stress-test";
import { ExactlyOnce } from "@/components/exactly-once";
import { LedgerFeed } from "@/components/ledger-feed";
import {
  ConsoleHeader,
  Empty,
  Figure,
  LedgerSection,
  Meter,
  reasonLabel,
  utcStamp,
} from "@/components/console-kit";
import { Mono, Stamp, TextLink } from "@/components/site-kit";
import { adminPageAllowed } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: true },
  title: "Live dashboard",
  description:
    "Watch agent spend commit and get denied in real time against one enforced budget, with live balances, burn rates, and the denial feed.",
  alternates: { canonical: "/dashboard" },
};

const TYPE_LABEL: Record<string, string> = {
  org: "Organization",
  team: "Team",
  agent: "Agent",
  vendor: "Vendor",
};

const LINK =
  "text-fg-dim underline decoration-brand-dim underline-offset-4 transition-colors hover:text-fg hover:decoration-brand";

export default async function Dashboard() {
  if (!(await adminPageAllowed())) return <ConsoleGate />;

  const [accounts, entries, denials, policies, fleetSpend, agents] = await Promise.all([
    listAccounts(),
    listEntries(40),
    listDenials(20),
    listPolicies(),
    listFleetSpend(500),
    listAgents(),
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
  const vendorAccounts = accounts.filter((a) => a.type === "vendor");
  const spent = vendorAccounts.reduce((sum, a) => sum + a.balanceMicro, 0n);
  const remaining = cap - spent;
  const pctSpent = cap > 0n ? Number((spent * 1000n) / cap) / 10 : 0;

  // eslint-disable-next-line react-hooks/purity -- request-time clock in an async Server Component
  const burn = forecast({ balanceMicro: remaining, events: fleetSpend, nowMs: Date.now() });
  const runway =
    burn.daysToDepletion == null
      ? "No recent burn"
      : burn.daysToDepletion >= 1
        ? `${burn.daysToDepletion.toFixed(burn.daysToDepletion < 10 ? 1 : 0)} days`
        : `${Math.max(1, Math.round(burn.daysToDepletion * 24))} hours`;

  const budgets = accounts
    .filter((a) => a.type === "org" || a.type === "team" || a.type === "agent")
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const vendors = vendorAccounts.map((a) => ({ id: a.id, name: a.name, type: a.type }));

  const tree = budgetTree(accounts);
  const anyActive = accounts.some((a) => a.type !== "vendor" && !a.frozen);
  const refusedMicro = denials.reduce((sum, d) => sum + d.attemptedMicro, 0n);

  const feedEntries = entries.map((e) => ({
    id: e.id,
    transactionId: e.transactionId,
    intent: e.intent ?? "spend",
    accountName: e.accountName,
    kind: e.kind,
    amount: formatUsd(e.amountMicro < 0n ? -e.amountMicro : e.amountMicro),
    hash: e.hash,
    prevHash: e.prevHash,
    agentId: e.agentId,
    createdAt: e.createdAt,
    receipt: e.receipt,
  }));

  return (
    <ConsoleShell tab="overview">
      <ConsoleHeader
        title={org?.name ?? "Your fleet"}
        note="Demo workspace with sample data. Nothing here spends real money."
        actions={<LiveRefresh />}
        intro={<StartHere />}
      />

      <LedgerSection
        id="budget"
        title="Org budget"
        note="One cap over every team and agent. The database refuses any spend past it."
      >
        <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_15rem] md:gap-12">
          <div className="min-w-0">
            <dl className="max-w-md text-[15px]">
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="text-fg-dim">Budget</dt>
                <dd className="tabular text-fg">{formatUsd(cap)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="text-fg-dim">Committed to vendors</dt>
                <dd className="tabular text-fg">({formatUsd(spent)})</dd>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-fg-mute pt-3">
                <dt className="text-fg">Left to spend</dt>
                <dd className="border-b-[3px] border-double border-fg-mute pb-0.5 font-display text-[2.6rem] font-medium leading-none tracking-[-0.02em] text-fg [font-variant-numeric:lining-nums_tabular-nums] sm:text-[3.2rem]">
                  {formatUsd(remaining)}
                </dd>
              </div>
            </dl>
            <div className="mt-9 max-w-md">
              <Meter pct={pctSpent} size="lg" label="Share of the org budget committed" />
              <div className="mt-3 flex justify-between gap-4 text-xs text-fg-mute">
                <span className="tabular text-fg-dim">{pctSpent.toFixed(1)}% committed</span>
                <span>Alerts at 50% and 80%</span>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <dl className="grid grid-cols-2 gap-6 md:grid-cols-1">
              <Figure
                label="Refused recently"
                tone={denials.length ? "deny" : "default"}
                value={<a href="#refusals">{denials.length}</a>}
                sub={`${formatUsd(refusedMicro)} kept in the budget`}
              />
              <Figure
                label="Runway"
                tone={burn.daysToDepletion != null && burn.daysToDepletion < 2 ? "deny" : "default"}
                value={runway}
                sub="At the current burn rate"
              />
            </dl>
            <div>
              <KillSwitch anyActive={anyActive} />
              <p className="mt-2 text-xs leading-relaxed text-fg-mute">
                {anyActive
                  ? "Freezes the org, every team and every agent in one write."
                  : "Every budget is frozen. Resume to let spends through."}
              </p>
            </div>
          </div>
        </div>
      </LedgerSection>

      <LedgerSection
        id="guardrails"
        title="Database guardrails"
        note={<TextLink href="/proof">Send these statements yourself</TextLink>}
      >
        <ul className="grid gap-x-8 gap-y-6 md:grid-cols-3">
          <Guardrail code="23514">
            <Mono>accounts_balance_nonnegative</Mono> refuses any balance below zero, whoever sends
            the write.
          </Guardrail>
          <Guardrail code="23514">
            <Mono>accounts_balance_within_cap</Mono> refuses any balance above its cap.
          </Guardrail>
          <Guardrail code="42501">
            The app connects as <Mono>stub_app</Mono>, which cannot update or delete a ledger entry.
          </Guardrail>
        </ul>
      </LedgerSection>

      <LedgerSection
        id="accounts"
        title="Accounts"
        note="Each spend binds to the tightest cap up the tree. Ticks mark the 50% and 80% alerts."
      >
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0">
            <ul className="divide-y divide-line border-y border-line">
              {tree.map(({ account, depth }) => (
                <BudgetRow key={account.id} account={account} depth={depth} />
              ))}
            </ul>
            <h3 className="mt-8 text-[13px] text-fg-mute">Credited to vendors</h3>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {vendorAccounts.map((v) => (
                <li key={v.id} className="flex items-baseline justify-between gap-4 py-2.5">
                  <span className="truncate text-[15px] text-fg">{v.name}</span>
                  <span className="tabular text-[15px] text-fg">{formatUsd(v.balanceMicro)}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-4 py-2.5">
                <span className="text-[15px] text-fg-dim">Total committed</span>
                <span className="tabular border-b-[3px] border-double border-fg-mute text-[15px] text-fg">
                  {formatUsd(spent)}
                </span>
              </li>
            </ul>
          </div>

          <div
            id="simulate"
            className="scroll-mt-28 self-start rounded-md border border-line-bright bg-surface p-5"
          >
            <h3 className="font-display text-xl font-medium text-fg">Try a spend</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-dim">
              It runs against the live budgets and policies, and books two journal lines if it
              commits.
            </p>
            <div className="mt-5">
              <SpendSimulator budgets={budgets} vendors={vendors} />
            </div>
          </div>
        </div>
      </LedgerSection>

      <LedgerSection
        id="journal"
        title="Journal"
        note={
          <>
            Each spend debits a budget and credits a vendor in one transaction. Select a hash for
            the receipt and the line it chains to.
            <a href="/api/export" className={`mt-3 block w-fit ${LINK}`}>
              Export CSV
            </a>
          </>
        }
      >
        <LedgerFeed entries={feedEntries} />
      </LedgerSection>

      <LedgerSection
        id="refusals"
        title="Refusals"
        note="Spends Stub turned down, with the reason. Each one is written down too."
      >
        {denials.length === 0 ? (
          <Empty>No refusals yet. Spend more than an agent has left and it shows up here.</Empty>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {denials.map((d) => (
              <li
                key={d.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto_6.5rem]"
              >
                <span className="tabular hidden text-xs text-fg-mute sm:block">
                  {utcStamp(d.createdAt)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[15px] text-fg">{d.intent ?? "spend"}</div>
                  <div className="truncate text-[13px] text-fg-mute">
                    {d.accountName}
                    {d.agentId && d.agentId !== d.accountName ? `, by ${d.agentId}` : ""}
                  </div>
                </div>
                <span className="tabular text-right text-[15px] text-fg-dim line-through decoration-deny/70 sm:order-last">
                  {formatUsd(d.attemptedMicro)}
                </span>
                <div className="col-span-2 sm:col-span-1">
                  <Stamp code={reasonLabel(d.reason)} label="" className="text-xs" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </LedgerSection>

      <LedgerSection
        id="ask"
        title="Ask the ledger"
        note="Your question becomes a parameterized query. The model never writes SQL."
      >
        <NlQuery />
      </LedgerSection>

      <LedgerSection
        id="policies"
        title="Policies"
        note="Rules every spend passes inside the same transaction: caps, windows, vendors and approvals."
      >
        <PolicyEditor policies={policyViews} budgets={budgets} vendors={vendors} />
      </LedgerSection>

      <LedgerSection
        id="agents"
        title="Agents"
        note="Issue a scoped key per agent. Spends made with it are pinned to that agent's budget."
      >
        <AgentRegistry
          agents={agents.map((a) => ({
            id: a.id,
            name: a.name,
            accountName: a.accountName,
            keyPreview: a.keyPreview,
            createdAt: a.createdAt,
          }))}
          budgets={budgets}
        />
      </LedgerSection>

      <LedgerSection
        id="drills"
        title="Drills"
        note="Race many writers at one budget and watch what the database lets through."
      >
        <div className="divide-y divide-line">
          <div className="pb-9">
            <StressTest />
          </div>
          <div className="pt-9">
            <ExactlyOnce />
          </div>
        </div>
      </LedgerSection>
    </ConsoleShell>
  );
}

function budgetTree(accounts: AccountRow[]): Array<{ account: AccountRow; depth: number }> {
  const budgets = accounts.filter((a) => a.type !== "vendor");
  const ids = new Set(budgets.map((a) => a.id));
  const out: Array<{ account: AccountRow; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of budgets) {
      const parent = a.parentId && ids.has(a.parentId) ? a.parentId : null;
      if (parent !== parentId) continue;
      out.push({ account: a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function BudgetRow({ account: a, depth }: { account: AccountRow; depth: number }) {
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_7.5rem_4rem] ${
        a.frozen ? "bg-deny-dim/10" : ""
      }`}
      style={{ paddingLeft: `${depth * 1.1}rem` }}
    >
      <div className="min-w-0">
        <div className={`truncate text-[15px] ${a.frozen ? "text-fg-dim" : "text-fg"}`}>
          {a.name}
        </div>
        <div className="text-xs text-fg-mute">
          {TYPE_LABEL[a.type]}
          {a.frozen ? ", frozen" : ""}
        </div>
      </div>
      <div className="order-last col-span-3 flex items-center gap-3 sm:order-none sm:col-span-1">
        {a.capMicro != null ? (
          <>
            <Meter pct={a.burn.pct} label={`${a.name} budget used`} />
            <span className="tabular w-9 shrink-0 text-right text-[11px] text-fg-mute">
              {a.burn.pct}%
            </span>
          </>
        ) : (
          <span className="text-xs text-fg-mute">No cap</span>
        )}
      </div>
      <div className="text-right">
        <div className="tabular text-[15px] text-fg">{formatUsd(a.balanceMicro)}</div>
        {a.capMicro != null && (
          <div className="tabular text-[11px] text-fg-mute">of {formatUsd(a.capMicro)}</div>
        )}
      </div>
      <div className="text-right">
        {a.type === "org" ? null : <FreezeToggle accountId={a.id} frozen={a.frozen} />}
      </div>
    </li>
  );
}

function Guardrail({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <li className="min-w-0">
      <Stamp code={code} className="text-xs" />
      <p className="mt-3 text-sm leading-relaxed text-fg-dim">{children}</p>
    </li>
  );
}
