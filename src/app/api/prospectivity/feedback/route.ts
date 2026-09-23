// Field-validation feedback loop — the path from a priority MAP to a
// government ASSET. Geologists record ground verdicts on prospectivity
// targets; verdicts persist for the next retrain and are surfaced as
// "targets reviewed" in the UI.
//   POST /api/prospectivity/feedback  — role officer|admin, upsert verdict
//   GET  /api/prospectivity/feedback  — aggregates + recent items (public read)
import { db } from "@/lib/db";
import { parseWith } from "@/lib/validate";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { requireRole } from "@/lib/auth";

const FeedbackBody = z.object({
  mineCode: z.string().regex(/^[A-Z]{4}$/),
  lat: z.number().min(15).max(30),
  lng: z.number().min(72).max(90),
  verdict: z.enum(["verified", "rejected"]),
  note: z.string().max(500).optional(),
});

export async function GET() {
  const [byVerdict, byMine, recent] = await Promise.all([
    db.targetFeedback.groupBy({ by: ["verdict"], _count: { _all: true } }),
    db.targetFeedback.groupBy({ by: ["mineCode", "verdict"], _count: { _all: true } }),
    db.targetFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const total = byVerdict.reduce((s, v) => s + v._count._all, 0);
  return Response.json(
    {
      total,
      byVerdict: Object.fromEntries(byVerdict.map((v) => [v.verdict, v._count._all])),
      byMine: byMine.map((m) => ({ mineCode: m.mineCode, verdict: m.verdict, count: m._count._all })),
      recent,
      loop: "verdicts persist in the warehouse and gate the next prospectivity retrain",
    },
    { headers: { "cache-control": "public, max-age=15, stale-while-revalidate=60" } },
  );
}

export async function POST(req: Request) {
  const rl = rateLimit(`feedback:${req.headers.get("x-forwarded-for") ?? "local"}`, 60, 1);
  if (!rl.ok) {
    return Response.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  const guard = requireRole(req, "officer");
  if (!guard.ok) return guard.response;

  const raw = await req.json().catch(() => null);
  const parsed = parseWith(FeedbackBody, raw);
  if (!parsed.ok) return parsed.response;
  const { mineCode, lat, lng, verdict, note } = parsed.data;

  // Attach the model score at feedback time if a portfolio cell matches
  // within ~110 m (0.001°) — keeps the verdict auditable against the map.
  let score: number | null = null;
  try {
    const portfolio = JSON.parse(
      await import("node:fs/promises").then((fs) => fs.readFile(
        "/home/z/my-project/research/multi-mine/artifacts/portfolio.json", "utf8"),
      ),
    ) as { per_mine?: { code: string; cells?: { lat: number; lng: number; probability: number }[] }[] };
    const mine = portfolio.per_mine?.find((m) => m.code === mineCode);
    let bestD = Infinity;
    for (const c of mine?.cells ?? []) {
      const d = Math.abs(c.lat - lat) + Math.abs(c.lng - lng);
      if (d < bestD) { bestD = d; score = c.probability; }
    }
    if (bestD > 0.002) score = null; // outside tolerance → no claim
  } catch { /* portfolio unavailable → score stays null (honest) */ }

  const row = await db.targetFeedback.create({
    data: {
      mineCode, lat, lng, verdict,
      note: note ?? null,
      score: score ?? undefined,
      createdBy: guard.session.sub,
    },
  });
  await db.auditLog.create({
    data: {
      actor: guard.session.sub,
      action: "target.feedback",
      detail: JSON.stringify({ mineCode, verdict, score }),
    },
  });
  return Response.json({ ok: true, id: row.id, scoreAtFeedback: score }, { status: 201 });
}
