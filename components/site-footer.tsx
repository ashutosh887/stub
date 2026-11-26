import Image from "next/image";
import Link from "next/link";
import { FaGithub, FaNpm } from "react-icons/fa6";
import { SiHashnode } from "react-icons/si";
import { NpmStatsLink } from "@/components/npm-stats-link";
import { BLOG_URL, GITHUB_URL } from "@/config/seo";

const RESULTS_URL = `${GITHUB_URL}/blob/main/measurements/wa-review/RESULTS.md`;

const LINK = "transition-colors hover:text-fg";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image src="/logo.png" alt="" width={22} height={22} className="rounded-[4px]" />
            <span className="font-display text-lg font-medium text-fg">Stub</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg-mute">
            One budget your agents can&apos;t break. Runs on Amazon Aurora DSQL, built with v0 and
            Vercel. MIT licensed.
          </p>
        </div>

        <FooterColumn head="Product">
          <li>
            <Link href="/how-it-works" className={LINK}>
              How it works
            </Link>
          </li>
          <li>
            <Link href="/proof" className={LINK}>
              Try to break it
            </Link>
          </li>
          <li>
            <Link href="/dashboard" className={LINK}>
              Dashboard
            </Link>
          </li>
        </FooterColumn>

        <FooterColumn head="Source">
          <li>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className={`${LINK} inline-flex items-center gap-2`}
            >
              <FaGithub className="h-4 w-4" /> GitHub
            </a>
          </li>
          <li>
            <NpmStatsLink
              ariaLabel="trystub on npm"
              placement="above"
              className={`${LINK} inline-flex items-center gap-2`}
            >
              <FaNpm className="h-4 w-4" /> trystub on npm
            </NpmStatsLink>
          </li>
          <li>
            <a href={RESULTS_URL} target="_blank" rel="noreferrer" className={LINK}>
              Review results
            </a>
          </li>
          <li>
            <a
              href={BLOG_URL}
              target="_blank"
              rel="noreferrer"
              className={`${LINK} inline-flex items-center gap-2`}
            >
              <SiHashnode className="h-4 w-4" /> Blog
            </a>
          </li>
        </FooterColumn>
      </div>
    </footer>
  );
}

function FooterColumn({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm text-fg-mute">{head}</h2>
      <ul className="mt-3 space-y-2 text-sm text-fg-dim">{children}</ul>
    </div>
  );
}
