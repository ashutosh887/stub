import Image from "next/image";
import Link from "next/link";
import { FaGithub, FaNpm } from "react-icons/fa6";
import { NpmStatsLink } from "@/components/npm-stats-link";
import { GITHUB_URL } from "@/config/seo";

export function SiteNav({ current }: { current?: "home" | "how" | "proof" | "dashboard" }) {
  return (
    <nav className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="Stub home"
          aria-current={current === "home" ? "page" : undefined}
          className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Image src="/logo.png" alt="" width={26} height={26} className="rounded-[5px]" priority />
          <span className="font-display text-[1.35rem] font-medium tracking-[-0.02em] text-fg">
            Stub
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-0.5 text-sm sm:gap-1">
          <NavLink href="/how-it-works" active={current === "how"}>
            How it works
          </NavLink>
          <NavLink href="/proof" active={current === "proof"}>
            Proof
          </NavLink>
          <NavLink href="/dashboard" active={current === "dashboard"}>
            Console
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
            className="hidden rounded-md p-2 text-fg-dim transition-colors hover:text-fg min-[400px]:inline-flex"
          >
            <FaGithub className="h-[18px] w-[18px]" />
          </a>
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
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-md px-2 py-1.5 underline-offset-[18px] transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:px-3 ${
        active ? "text-fg underline decoration-brand decoration-2" : "text-fg-dim"
      }`}
    >
      {children}
    </Link>
  );
}
