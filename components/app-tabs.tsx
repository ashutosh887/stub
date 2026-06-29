import Link from "next/link";

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
    <div className="border-b border-line bg-ink/60">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-6 py-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`shrink-0 rounded-md px-3 py-1.5 transition-colors hover:text-fg ${
              current === t.key ? "bg-surface text-fg" : "text-fg-dim"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
