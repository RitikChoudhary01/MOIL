"use client";

// Field-validation panel — the government feedback loop made visible.
// Officers/geologists mark prospectivity targets VERIFIED/REJECTED after
// ground checks; verdicts persist (TargetFeedback) and gate the next retrain.
// Read view is public; the buttons require an officer|admin session and
// surface the server's 401/403 honestly instead of hiding themselves.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, XCircle } from "lucide-react";

interface FeedbackSummary {
  total: number;
  byVerdict: Record<string, number>;
  recent: { id: string; mineCode: string; verdict: string; score: number | null; createdAt: string }[];
  loop: string;
}

export function FieldValidationPanel() {
  const [data, setData] = useState<FeedbackSummary | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/prospectivity/feedback")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(load, [load]);

  async function submit(verdict: "verified" | "rejected") {
    setBusy(true);
    setMsg(null);
    try {
      // Demo coordinates: Sausar-belt top target vicinity (Balaghat lease).
      // In field use the map click passes exact cell lat/lng.
      const res = await fetch("/api/prospectivity/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mineCode: "BLGT",
          lat: 21.87,
          lng: 80.03,
          verdict,
          note: "ground check via field-validation panel",
        }),
      });
      const body = await res.json();
      setMsg(
        res.ok
          ? `Recorded ${verdict} (score at feedback: ${body.scoreAtFeedback ?? "n/a"})`
          : `${res.status}: ${body.error ?? "failed"} — sign in as officer/admin`,
      );
      if (res.ok) load();
    } catch {
      setMsg("network error");
    } finally {
      setBusy(false);
    }
  }

  const verified = data?.byVerdict?.verified ?? 0;
  const rejected = data?.byVerdict?.rejected ?? 0;

  return (
    <section
      aria-label="Field validation feedback loop"
      className="rounded-xl border bg-card p-4"
    >
      <div className="mb-2 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-amber-600" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Field validation loop</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {data ? `${data.total} targets reviewed` : "…"}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{data?.loop ?? "Geologists record ground verdicts on priority targets; verdicts persist in the warehouse and gate the next model retrain."}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {verified} verified
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> {rejected} rejected
        </span>
        <span className="ml-auto flex gap-2">
          <button
            onClick={() => submit("verified")} disabled={busy}
            className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            Mark verified
          </button>
          <button
            onClick={() => submit("rejected")} disabled={busy}
            className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            Mark rejected
          </button>
        </span>
      </div>
      {msg && <p className="mt-2 text-[11px] text-muted-foreground" role="status">{msg}</p>}
    </section>
  );
}
