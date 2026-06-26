"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function LiveRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(true);
  const [pulse, setPulse] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!live) return;
    timer.current = setInterval(() => {
      router.refresh();
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, intervalMs, router]);

  return (
    <button
      onClick={() => setLive((v) => !v)}
      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 transition-colors hover:border-line-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      title={live ? "Pause live updates" : "Resume live updates"}
    >
      <span className="relative flex h-2 w-2">
        {live && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full bg-commit opacity-75 ${
              pulse ? "animate-ping" : ""
            }`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-commit" : "bg-fg-mute"}`} />
      </span>
      <span className="tabular text-xs text-fg-dim">
        Aurora DSQL · us-east-1 / us-east-2 {live ? "· live" : "· paused"}
      </span>
    </button>
  );
}
