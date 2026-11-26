import Link from "next/link";
import { SiteNav } from "@/components/site-nav";

export type AppTab = "overview" | "incident" | "settlement" | "audit" | "attribution";

const TABS: Array<{ key: AppTab; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/dashboard" },
  { key: "incident", label: "Incident replay", href: "/incident" },
  { key: "settlement", label: "Settlement", href: "/settlement" },
  { key: "audit", label: "Audit", href: "/audit" },
  { key: "attribution", label: "Attribution", href: "/attribution" },
];

export function AppTabs({ current }: { current: AppTab }) {
  return (
    <nav
      aria-label="Console"
      className="sticky top-14 z-30 border-b border-line bg-ink/90 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:gap-2 sm:px-6">
        {TABS.map((t) => {
          const active = current === t.key;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-3 ${
                active
                  ? "border-brand text-fg"
                  : "border-transparent text-fg-dim hover:border-line-bright hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function ConsoleShell({ tab, children }: { tab: AppTab; children: React.ReactNode }) {
  return (
    <>
      <SiteNav current="dashboard" />
      <AppTabs current={tab} />
      <main className="pb-16">{children}</main>
    </>
  );
}
