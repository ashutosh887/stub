"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

async function postFreeze(body: Record<string, unknown>) {
  const res = await fetch("/api/freeze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "freeze failed");
}

export function KillSwitch({ anyActive }: { anyActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await postFreeze({ all: true, frozen: anyActive });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;
  return (
    <button
      onClick={toggle}
      disabled={working}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 ${
        anyActive
          ? "border-deny-dim bg-deny-dim/20 text-deny hover:bg-deny-dim/30"
          : "border-commit-dim bg-commit-dim/20 text-commit hover:bg-commit-dim/30"
      }`}
    >
      {working ? "…" : anyActive ? "Freeze all spending" : "Resume all spending"}
    </button>
  );
}

export function FreezeToggle({ accountId, frozen }: { accountId: string; frozen: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await postFreeze({ accountId, frozen: !frozen });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;
  return (
    <button
      onClick={toggle}
      disabled={working}
      title={frozen ? "Resume this account" : "Freeze this account"}
      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 ${
        frozen
          ? "bg-deny-dim/30 text-deny hover:bg-deny-dim/50"
          : "text-fg-mute hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {working ? "…" : frozen ? "Frozen" : "Freeze"}
    </button>
  );
}
