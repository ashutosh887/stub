"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FOCUS } from "@/components/site-kit";

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
      className={`w-full rounded-md border-2 px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${FOCUS} ${
        anyActive
          ? "border-deny text-deny hover:bg-deny/10"
          : "border-commit text-commit hover:bg-commit/10"
      }`}
    >
      {working
        ? anyActive
          ? "Freezing…"
          : "Resuming…"
        : anyActive
          ? "Freeze all spending"
          : "Resume all spending"}
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
      className={`rounded-md px-2 py-1 text-[13px] transition-colors disabled:opacity-50 ${FOCUS} ${
        frozen
          ? "border border-deny-dim text-deny hover:bg-deny/10"
          : "text-fg-mute hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {working ? "…" : frozen ? "Resume" : "Freeze"}
    </button>
  );
}
