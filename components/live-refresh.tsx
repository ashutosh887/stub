"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FOCUS } from "@/components/site-kit";

export function LiveRefresh({ intervalMs = 12000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [live, setLive] = useState(true);
  const [pulse, setPulse] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!live) return;
    timer.current = setInterval(() => {
      if (document.hidden) return;
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
      startTransition(() => router.refresh());
    }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, intervalMs, router]);

  return (
    <button
      onClick={() => setLive((v) => !v)}
      aria-pressed={live}
      className={`flex items-center gap-2 rounded-md border border-line-bright px-3 py-1.5 text-[13px] text-fg-dim transition-colors hover:border-fg-mute hover:text-fg ${FOCUS}`}
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
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-commit" : "bg-fg-mute"}`}
        />
      </span>
      {live ? `Live, every ${Math.round(intervalMs / 1000)}s` : "Paused"}
    </button>
  );
}
