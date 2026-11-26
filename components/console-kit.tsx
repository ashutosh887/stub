import { FOCUS } from "@/components/site-kit";

export const BUTTON = {
  primary: `inline-flex items-center justify-center rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`,
  secondary: `inline-flex items-center justify-center rounded-md border border-line-bright px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:border-fg-mute hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`,
  quiet: `inline-flex items-center justify-center rounded-md px-2 py-1 text-[13px] text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50 ${FOCUS}`,
};

export const INPUT =
  "w-full min-w-0 rounded-md border border-line-bright bg-ink px-3 py-2 text-sm text-fg placeholder:text-fg-mute focus:border-brand focus:outline-none disabled:opacity-50";

export const REASON_LABEL: Record<string, string> = {
  cap_exceeded: "Over budget",
  team_cap_exceeded: "Over team budget",
  org_cap_exceeded: "Over org budget",
  account_frozen: "Account frozen",
  velocity_tripped: "Velocity breaker",
  per_txn_limit: "Over per-spend cap",
  window_limit: "Over window cap",
  vendor_blocked: "Vendor blocked",
  vendor_not_allowed: "Vendor not allowed",
  unknown_vendor: "Unknown vendor",
  payee_not_vendor: "Payee not a vendor",
  payee_is_budget: "Payee is the budget",
  needs_approval: "Needs approval",
};

export const reasonLabel = (reason: string) => REASON_LABEL[reason] ?? reason.replace(/_/g, " ");

export const utcStamp = (iso: string) => iso.slice(5, 16).replace("T", " ");

function Margin({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={`margin-rule min-w-0 border-l-[3px] pl-3 lg:border-l-0 lg:border-r-[3px] lg:pl-0 lg:pr-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function ConsoleHeader({
  title,
  intro,
  note,
  actions,
}: {
  title: string;
  intro?: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header>
      <div className="mx-auto grid max-w-6xl px-4 sm:px-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-12">
        <Margin className="hidden lg:block lg:pt-12">
          {note && <div className="text-sm leading-relaxed text-fg-mute">{note}</div>}
        </Margin>
        <div className="min-w-0 pt-9 pb-8 lg:pt-12 lg:pb-10">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <h1 className="max-w-3xl font-display text-[2.2rem] font-medium leading-[1.05] tracking-[-0.025em] text-fg sm:text-[2.9rem]">
              {title}
            </h1>
            {actions && <div className="flex shrink-0 items-center gap-3 sm:pt-2">{actions}</div>}
          </div>
          {intro && (
            <div className="mt-4 max-w-2xl text-[16px] leading-relaxed text-fg-dim">{intro}</div>
          )}
          {note && <div className="mt-3 text-sm text-fg-mute lg:hidden">{note}</div>}
        </div>
      </div>
    </header>
  );
}

export function LedgerSection({
  id,
  title,
  note,
  children,
}: {
  id?: string;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line">
      <div className="mx-auto grid max-w-6xl px-4 sm:px-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-12">
        <Margin className="mt-8 lg:mt-0 lg:pt-9 lg:pb-9">
          <h2 className="font-display text-[1.45rem] font-medium leading-tight tracking-[-0.015em] text-fg">
            {title}
          </h2>
          {note && <div className="mt-2 text-sm leading-relaxed text-fg-mute">{note}</div>}
        </Margin>
        <div className="min-w-0 py-6 lg:py-9">{children}</div>
      </div>
    </section>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] text-fg-dim">{label}</span>
      {children}
    </label>
  );
}

export type Tone = "default" | "commit" | "deny" | "warn" | "brand" | "mute";

export const TONE: Record<Tone, string> = {
  default: "text-fg",
  commit: "text-commit",
  deny: "text-deny",
  warn: "text-warn",
  brand: "text-brand",
  mute: "text-fg-mute",
};

export function Figure({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-fg-mute">{label}</dt>
      <dd className={`tabular mt-1 text-lg ${TONE[tone]}`}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-fg-mute">{sub}</dd>}
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "commit" | "deny" | "warn";
  children: React.ReactNode;
}) {
  const color =
    tone === "commit"
      ? "border-commit text-commit"
      : tone === "warn"
        ? "border-warn text-warn"
        : "border-deny text-deny";
  return (
    <div role="status" className={`rise border-l-2 bg-surface-2 px-3.5 py-2.5 text-sm ${color}`}>
      {children}
    </div>
  );
}

function meterFill(pct: number): string {
  if (pct >= 100) return "var(--color-deny)";
  if (pct >= 80) return "var(--color-warn)";
  return "var(--color-commit)";
}

export function Meter({
  pct,
  size = "sm",
  label,
  ticks = [50, 80],
}: {
  pct: number;
  size?: "sm" | "lg";
  label: string;
  ticks?: number[];
}) {
  const width = Math.max(0, Math.min(pct, 100));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      className={`relative w-full bg-line ${size === "lg" ? "h-2" : "h-1.5"}`}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-700"
        style={{ width: `${width}%`, backgroundColor: meterFill(pct) }}
      />
      {ticks.map((t) => (
        <span
          key={t}
          aria-hidden
          className={`absolute w-px ${size === "lg" ? "-top-1.5 -bottom-1.5 bg-fg-mute" : "inset-y-0 bg-ink"}`}
          style={{ left: `${t}%` }}
        />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-sm text-fg-mute">{children}</p>;
}
