"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "login failed");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-300 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-700 text-white">
            <span className="text-lg font-bold">M</span>
          </div>
          <h1 className="text-xl font-semibold text-stone-900">MOIL Intelligence</h1>
          <p className="mt-1 text-sm text-stone-500">Sign in to access the dashboard</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-stone-600">Official email</label>
            <input
              id="email" type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-amber-700 focus:ring-1 focus:ring-amber-700"
              placeholder="officer@moil.gov.in"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-stone-600">Password</label>
            <input
              id="password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-amber-700 focus:ring-1 focus:ring-amber-700"
            />
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>
          )}
          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-amber-700 py-2 text-sm font-medium text-white transition hover:bg-amber-800 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-stone-400">
          Demo accounts: admin@moil.gov.in · geologist@moil.gov.in · viewer@moil.gov.in<br />
          (passwords in DEPLOY_GUIDE.md — change before production)
        </p>
      </div>
    </main>
  );
}
