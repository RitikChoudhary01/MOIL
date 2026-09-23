// GET /api/drift — Module B feature drift: training-history window vs the
// most recent 12 mine-weeks, straight from the warehouse (real numbers).
// A "significant" verdict surfaces a retrain recommendation in the UI.
import { db } from "@/lib/db";
import { buildDriftReport, type DriftReport } from "@/lib/ml/drift";

const DRIFT_FEATURES = [
  "rainfall",
  "downtimeHours",
  "maintenanceEvents",
  "blastingDelays",
  "haulerCount",
  "equipmentUtilization",
  "actual",
] as const;

export async function GET() {
  const mines = await db.mine.findMany({ select: { id: true } });
  const all = await db.productionRecord.findMany({
    where: { mineId: { in: mines.map((m) => m.id) } },
    orderBy: { weekStart: "asc" },
    select: {
      weekStart: true, rainfall: true, downtimeHours: true,
      maintenanceEvents: true, blastingDelays: true,
      haulerCount: true, equipmentUtilization: true, actual: true,
    },
  });
  if (all.length < 60) {
    return Response.json({ error: "insufficient history for drift analysis" }, { status: 503 });
  }

  const RECENT_N = 12 * mines.length; // 12 weeks × mines
  const baselineRows = all.slice(0, all.length - RECENT_N);
  const recentRows = all.slice(all.length - RECENT_N);

  const pick = (rows: typeof all) =>
    Object.fromEntries(
      DRIFT_FEATURES.map((f) => [f, rows.map((r) => Number(r[f])).filter((v) => Number.isFinite(v))]),
    );

  const report: DriftReport = buildDriftReport(
    pick(baselineRows),
    pick(recentRows),
    { from: baselineRows[0].weekStart, to: baselineRows[baselineRows.length - 1].weekStart },
    { from: recentRows[0].weekStart, to: recentRows[recentRows.length - 1].weekStart },
  );

  return Response.json(
    { ...report, module: "B (production forecast)", note: "Module A drift is tracked via artifact freshness in /api/health until the next satellite scoring run. Caveat: the baseline spans all seasons, so a monsoon-heavy recent window inflates rainfall PSI — treat 'significant' as a trigger for expert review, not an automatic retrain." },
    { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" } },
  );
}
