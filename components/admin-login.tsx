"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BUTTON, Field, INPUT, Notice } from "@/components/console-kit";

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
    <div>
      <h2 className="font-display text-xl font-medium leading-tight text-fg">Operator sign-in</h2>
      <p className="mt-2 text-sm leading-relaxed text-fg-dim">
        Enter the admin token to manage budgets, policies and agents.
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        <Field label="Admin token">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="current-password"
            className={INPUT}
          />
        </Field>
        {error && <Notice tone="deny">{error}</Notice>}
        <button type="submit" disabled={busy || pending || !token} className={BUTTON.primary}>
          {busy || pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
