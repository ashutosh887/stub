import { FaGithub, FaNpm } from "react-icons/fa6";
import { SiHashnode } from "react-icons/si";
import { NpmStatsLink } from "@/components/npm-stats-link";

const GITHUB_URL = "https://github.com/ashutosh887/stub";
const BLOG_URL =
  "https://ashutosh887.hashnode.dev/building-a-budget-your-ai-agents-physically-cannot-overspend-on-aurora-dsql";

export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-fg-mute sm:flex-row">
      <span className="font-display text-base text-fg-dim">Stub</span>
      <span>
        One budget your agents can&apos;t break. Built with v0 and Vercel on Amazon Aurora DSQL.
      </span>
      <div className="flex items-center gap-5">
        <a
          href={BLOG_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-fg"
        >
          <SiHashnode className="h-4 w-4" /> Blog
        </a>
        <NpmStatsLink
          ariaLabel="trystub on npm"
          placement="above"
          className="inline-flex items-center gap-1.5 hover:text-fg"
        >
          <FaNpm className="h-4 w-4" /> npm
        </NpmStatsLink>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-fg"
        >
          <FaGithub className="h-4 w-4" /> GitHub
        </a>
      </div>
    </footer>
  );
}
