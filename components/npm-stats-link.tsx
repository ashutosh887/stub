"use client";

import { useCallback, useState } from "react";

const NPM_URL = "https://www.npmjs.com/package/trystub";
const REGISTRY_URL = "https://registry.npmjs.org/trystub/latest";
const REPO_API_URL = "https://api.github.com/repos/ashutosh887/stub";

type Stats = { version?: string; stars?: number };

let cached: Stats | null = null;
let inflight: Promise<Stats> | null = null;

function loadStats(): Promise<Stats> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = (async () => {
      const out: Stats = {};
      const [npm, gh] = await Promise.allSettled([
        fetch(REGISTRY_URL).then((r) => r.json()),
        fetch(REPO_API_URL).then((r) => r.json()),
      ]);
      if (npm.status === "fulfilled" && typeof npm.value?.version === "string") {
        out.version = npm.value.version;
      }
      if (gh.status === "fulfilled" && typeof gh.value?.stargazers_count === "number") {
        out.stars = gh.value.stargazers_count;
      }
      cached = out;
      return out;
    })();
  }
  return inflight;
}

export function NpmStatsLink({
  className,
  ariaLabel,
  placement = "below",
  children,
}: {
  className?: string;
  ariaLabel: string;
  placement?: "below" | "above";
  children: React.ReactNode;
}) {
  const [stats, setStats] = useState<Stats | null>(cached);
  const [open, setOpen] = useState(false);

  const reveal = useCallback(() => {
    setOpen(true);
    if (!cached) loadStats().then(setStats);
  }, []);

  const pos = placement === "below" ? "top-full mt-2" : "bottom-full mb-2";

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={reveal}
      onMouseLeave={() => setOpen(false)}
      onFocus={reveal}
      onBlur={() => setOpen(false)}
    >
      <a
        href={NPM_URL}
        target="_blank"
        rel="noreferrer"
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </a>
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line-bright bg-surface px-3 py-2 text-xs shadow-xl shadow-black/40 ${pos}`}
        >
          <span className="flex items-center gap-2">
            <span className="font-display text-fg">trystub</span>
            <span className="tabular text-brand">
              {stats?.version ? `v${stats.version}` : "latest"}
            </span>
          </span>
          <span className="mt-0.5 block text-fg-dim">
            {stats
              ? `★ ${typeof stats.stars === "number" ? stats.stars : 0} on GitHub`
              : "loading…"}
          </span>
        </span>
      )}
    </span>
  );
}
