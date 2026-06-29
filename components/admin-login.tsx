"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function AdminLogin() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "login failed");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="rounded-2xl border border-line bg-surface p-7">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight text-fg">Stub</span>
          <span className="text-[11px] uppercase tracking-[0.18em] text-fg-mute">control</span>
        </div>
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Sign in</h1>
        <p className="mt-1 text-sm text-fg-dim">Enter your admin token to manage spend controls.</p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
            autoFocus
            className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {error && <p className="text-xs text-deny">{error}</p>}
          <button
            type="submit"
            disabled={busy || pending || !token}
            className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-brand transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          >
            {busy || pending ? "…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
