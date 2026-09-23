"use client";

// Header session indicator — shows current role or a Sign-in link.
// Minimal on purpose: auth state comes from /api/auth/me (HttpOnly cookie).
import { useEffect, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";

interface Me {
  authenticated: boolean;
  user: { email: string; name: string; role: string } | null;
}

export function SessionBadge() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ authenticated: false, user: null }));
  }, []);

  if (!me) return null;
  if (!me.authenticated) {
    return (
      <a
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:border-amber-600 hover:text-amber-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
      >
        <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
        Sign in
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      {me.user?.name} · {me.user?.role}
    </span>
  );
}
