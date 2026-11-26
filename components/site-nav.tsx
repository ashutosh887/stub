import Image from "next/image";
import Link from "next/link";
import { FaGithub, FaNpm } from "react-icons/fa6";
import { NpmStatsLink } from "@/components/npm-stats-link";

const GITHUB_URL = "https://github.com/ashutosh887/stub";

export function SiteNav({ current }: { current?: "home" | "how" | "proof" | "dashboard" }) {
  return (
    <nav className="sticky top-0 z-40 border-b border-line bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" aria-label="Stub home" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={26} height={26} className="rounded-md" priority />
          <span className="font-display text-xl font-semibold text-fg">Stub</span>
        </Link>

        <div className="flex min-w-0 items-center gap-0.5 text-sm sm:gap-1">
          <NavLink href="/" active={current === "home"} className="hidden sm:inline-block">
            Product
          </NavLink>
          <NavLink href="/how-it-works" active={current === "how"}>
            How it works
          </NavLink>
          <NavLink href="/proof" active={current === "proof"}>
            Proof
          </NavLink>
          <NpmStatsLink
            ariaLabel="trystub on npm"
            placement="below"
            className="hidden rounded-md p-2 text-fg-dim transition-colors hover:text-fg sm:inline-flex"
          >
            <FaNpm className="h-5 w-5" />
          </NpmStatsLink>
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
            className="ml-1 shrink-0 whitespace-nowrap rounded-md border border-brand-dim bg-brand/10 px-2 sm:px-3 py-1.5 font-medium text-brand transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="sm:hidden">Dashboard</span>
            <span className="hidden sm:inline">Open dashboard</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  active,
  className = "",
  children,
}: {
  href: string;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`whitespace-nowrap rounded-md px-2 py-1.5 transition-colors hover:text-fg sm:px-3 ${className} ${
        active ? "text-fg" : "text-fg-dim"
      }`}
    >
      {children}
    </Link>
  );
}
