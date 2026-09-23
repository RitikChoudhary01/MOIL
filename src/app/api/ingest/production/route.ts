// POST /api/ingest/production — MOIL ERP → warehouse ingestion connector.
// Role-gated (officer|admin), zod-validated row schema, UPSERT on
// (mine, weekStart), audit-logged, model-cache invalidating. This is the
// plug-and-play entry point for real mine data (see /api/ingest/spec).
import { db } from "@/lib/db";
import { parseWith, IngestBody } from "@/lib/validate";
import { rateLimit } from "@/lib/rate-limit";
import { cacheInvalidate } from "@/lib/api-cache";
import { requireRole } from "@/lib/auth";
import { readFile } from "node:fs/promises";

// REAL ERA5 weekly archive (Open-Meteo, CC-BY-4.0) — auto-fills rainfall
// when the ERP feed omits it, exactly as /api/ingest/spec promises.
// Loaded once per process; the archive is immutable (fetched 2026-08-26).
let era5: Record<string, { weeks: Record<string, { rainfall_mm: number }> }> | null = null;
async function loadEra5() {
  if (!era5) {
    era5 = JSON.parse(
      await readFile("/home/z/my-project/research/real-pipeline/artifacts/era5_weekly_per_mine.json", "utf8"),
    );
  }
  return era5;
}

export async function POST(req: Request) {
  const guard = requireRole(req, "officer");
  if (!guard.ok) return guard.response;

  const rl = rateLimit(`ingest:${req.headers.get("x-forwarded-for") ?? "local"}`, 30, 0.5);
  if (!rl.ok) {
    return Response.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = parseWith(IngestBody, raw);
  if (!parsed.ok) return parsed.response;
  const { rows } = parsed.data;
  const weather = await loadEra5();

  const mines = await db.mine.findMany({ select: { id: true, code: true } });
  const byCode = new Map(mines.map((m) => [m.code, m.id]));

  let inserted = 0, updated = 0;
  const skipped: { index: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const mineId = byCode.get(r.mineCode);
    if (!mineId) {
      skipped.push({ index: i, reason: `unknown mineCode ${r.mineCode}` });
      continue;
    }
    const weekStart = new Date(`${r.weekStart}T00:00:00.000Z`);
    if (Number.isNaN(weekStart.getTime()) || weekStart.getUTCDay() !== 1) {
      skipped.push({ index: i, reason: `weekStart ${r.weekStart} is not a Monday` });
      continue;
    }
    const existing = await db.productionRecord.findFirst({
      where: { mineId, weekStart },
      select: { id: true },
    });
    // ERA5 auto-fill (REAL data, never fabricated): if the ERP omits rainfall,
    // fill from the archive for that mine-week; if the archive lacks the week,
    // reject the row honestly instead of inventing a value.
    let rainfall = r.rainfall;
    if (rainfall === undefined) {
      const w = weather[r.mineCode]?.weeks?.[r.weekStart];
      if (w && typeof w.rainfall_mm === "number") {
        rainfall = w.rainfall_mm;
      } else {
        skipped.push({ index: i, reason: `no ERA5 rainfall for ${r.mineCode} week ${r.weekStart} — pass rainfall explicitly` });
        continue;
      }
    }
    const data = {
      actual: r.actual,
      rainfall,
      ...(r.plannedTarget !== undefined ? { plannedTarget: r.plannedTarget } : {}),
      ...(r.downtimeHours !== undefined ? { downtimeHours: r.downtimeHours } : {}),
      ...(r.maintenanceEvents !== undefined ? { maintenanceEvents: r.maintenanceEvents } : {}),
      ...(r.blastingDelays !== undefined ? { blastingDelays: r.blastingDelays } : {}),
      ...(r.haulerCount !== undefined ? { haulerCount: r.haulerCount } : {}),
      ...(r.equipmentUtilization !== undefined ? { equipmentUtilization: r.equipmentUtilization } : {}),
    };
    if (existing) {
      await db.productionRecord.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      // INSERT = a brand-new production week: the warehouse schema needs the
      // full ops picture (maintenance/blasting/haulers/utilisation feed the
      // forecast). A feed that cannot supply them is skipped HONESTLY —
      // never defaulted to fabricated zeros. Corrections (UPDATE) may be partial.
      const missing = (
        [
          ["maintenanceEvents", r.maintenanceEvents],
          ["blastingDelays", r.blastingDelays],
          ["haulerCount", r.haulerCount],
          ["equipmentUtilization", r.equipmentUtilization],
        ] as const
      )
        .filter(([, v]) => v === undefined)
        .map(([k]) => k);
      if (missing.length > 0) {
        skipped.push({ index: i, reason: `new week requires full ops fields — missing: ${missing.join(", ")}` });
        continue;
      }
      await db.productionRecord.create({
        data: { mineId, weekStart, plannedTarget: r.plannedTarget ?? r.actual, ...data },
      });
      inserted++;
    }
  }

  if (inserted + updated > 0) {
    cacheInvalidate("production:");
    cacheInvalidate("overview:");
    cacheInvalidate("simulate:");
  }

  const audit = await db.auditLog.create({
    data: {
      actor: guard.session.sub,
      action: "ingest.production",
      detail: JSON.stringify({ received: rows.length, inserted, updated, skipped: skipped.length }),
    },
  });

  return Response.json({ ok: true, inserted, updated, skipped, auditId: audit.id });
}
