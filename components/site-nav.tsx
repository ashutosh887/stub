import Link from "next/link";
import { FaGithub, FaNpm } from "react-icons/fa6";

const GITHUB_URL = "https://github.com/ashutosh887/stub";
const NPM_URL = "https://www.npmjs.com/package/trystub";

export function SiteNav({ current }: { current?: "home" | "how" | "dashboard" }) {
  return (
    <nav className="sticky top-0 z-40 border-b border-line bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-baseline gap-2" aria-label="Stub home">
          <span className="font-display text-xl font-semibold text-fg">Stub</span>
          <span className="hidden text-[11px] uppercase tracking-[0.18em] text-fg-mute sm:inline">
            agent spend ledger
          </span>
        </Link>

        <div className="flex items-center gap-1 text-sm">
          <NavLink href="/" active={current === "home"}>
            Product
          </NavLink>
          <NavLink href="/how-it-works" active={current === "how"}>
            How it works
          </NavLink>
          <NavLink href="/dashboard" active={current === "dashboard"}>
            Dashboard
          </NavLink>
          <a
            href={NPM_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="trystub on npm"
            title="trystub on npm"
            className="rounded-md p-2 text-fg-dim transition-colors hover:text-fg"
          >
            <FaNpm className="h-5 w-5" />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            title="Source on GitHub"
            className="rounded-md p-2 text-fg-dim transition-colors hover:text-fg"
          >
            <FaGithub className="h-[18px] w-[18px]" />
          </a>
          <Link
            href="/dashboard"
            className="ml-1 rounded-md border border-brand-dim bg-brand/10 px-3 py-1.5 font-medium text-brand transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 transition-colors hover:text-fg ${
        active ? "text-fg" : "text-fg-dim"
      }`}
    >
      {children}
    </Link>
  );
}
