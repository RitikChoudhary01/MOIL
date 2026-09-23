import { db } from "@/lib/db";
import { parseFactors, monthKey, monthLabel, cellTonnage } from "@/lib/api-utils";
import { DOMAIN_INSIGHTS } from "@/lib/mines";
import { cached } from "@/lib/api-cache";
import { guard } from "@/lib/rate-limit";
import { dataCacheHeaders, logApi, requestId, jsonErrorWithId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "overview");
  if (blocked) return blocked;
  try {
    const payload = await cached("api:overview", 30_000, loadOverview);
    logApi({ route: "/api/overview", status: 200, startedAt: started, requestId: reqId });
    return Response.json(payload, { headers: dataCacheHeaders() });
  } catch (e) {
    logApi({ route: "/api/overview", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Failed to load overview", request);
  }
}

async function loadOverview() {
    const [records, predictions, recommendations, cells, mines, metaRows] =
      await Promise.all([
        db.productionRecord.findMany({
          select: {
            weekStart: true,
            plannedTarget: true,
            actual: true,
            fitted: true,
            rainfall: true,
            downtimeHours: true,
          },
          orderBy: { weekStart: "asc" },
        }),
        db.prediction.findMany({ include: { mine: true }, orderBy: { weekStart: "asc" } }),
        db.recommendation.findMany({ include: { mine: true } }),
        db.reserveCell.findMany({
          select: { probability: true, mineId: true },
        }),
        db.mine.findMany({ select: { id: true, oreGrade: true, code: true } }),
        db.modelMeta.findMany(),
      ]);

    // ---- Monthly aggregation (last 13 months + forecast month) ----
    const monthlyMap = new Map<
      string,
      { actual: number; target: number; fitted: number; rainfall: number }
    >();
    for (const r of records) {
      const k = monthKey(r.weekStart);
      const m =
        monthlyMap.get(k) ?? { actual: 0, target: 0, fitted: 0, rainfall: 0 };
      m.actual += r.actual;
      m.target += r.plannedTarget;
      m.fitted += r.fitted ?? 0;
      m.rainfall += r.rainfall;
      monthlyMap.set(k, m);
    }
    const monthly = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([k, v]) => ({
        month: monthLabel(k),
        key: k,
        actual: Math.round(v.actual),
        target: Math.round(v.target),
        fitted: Math.round(v.fitted),
        rainfall: Math.round(v.rainfall),
      }));

    // ---- Forecast rollup: ONE labelled point for the full 4-week horizon ----
    // The model's horizon is the NEXT 4 WEEKS (h1..h4), which can straddle a
    // calendar-month boundary. Bucketing by calendar month would show a 1-week
    // "August" prediction colliding with August's actuals and a 3-week
    // "September" — visually a false production collapse. Instead we publish a
    // single aggregate point that matches the "Next 4 weeks" KPI exactly.
    const horizon = [...predictions]
      .filter((p) => p.horizon <= 4)
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
    const fcPredicted = horizon.reduce((a, p) => a + p.predicted, 0);
    const fcTarget = horizon.reduce((a, p) => a + p.target, 0);
    const firstW = horizon[0]?.weekStart;
    const lastW = horizon[horizon.length - 1]?.weekStart;
    const fmtD = (d?: Date) =>
      d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    const forecastMonths = [
      {
        month: `Next 4 wks (${fmtD(firstW)}–${fmtD(lastW)})`,
        // key from the LAST horizon week so this point always sorts after
        // every history month (e.g. "2026-09-fc" > "2026-09" > "2026-08")
        key: lastW ? `${monthKey(lastW)}-fc` : "fc",
        predicted: Math.round(fcPredicted),
        target: Math.round(fcTarget),
        actual: null as number | null,
      },
    ];

    // ---- KPIs ----
    const now = new Date();
    const lastFullMonthKey = monthKey(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    );
    const lastMonth = monthly.find((m) => m.key === lastFullMonthKey);
    const h12 = predictions.filter((p) => p.horizon <= 2);
    const next4 = predictions.filter((p) => p.horizon <= 4);
    const riskMines = new Set(
      predictions.filter((p) => p.status === "risk").map((p) => p.mineId),
    );
    const proposedRecs = recommendations.filter((r) => r.status === "proposed");

    const gradeById = new Map(mines.map((m) => [m.id, m.oreGrade]));
    let estReserveMt = 0;
    let highPotentialCells = 0;
    for (const c of cells) {
      const tonnage = cellTonnage(gradeById.get(c.mineId) ?? 35);
      estReserveMt += c.probability * tonnage;
      if (c.probability > 0.6) highPotentialCells++;
    }

    // ---- Top risks (most severe h1-2) ----
    const topRisks = [...h12]
      .sort((a, b) => a.shortfall - b.shortfall)
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        mineCode: p.mine.code,
        mineName: p.mine.name,
        weekStart: p.weekStart.toISOString(),
        horizon: p.horizon,
        predicted: p.predicted,
        target: p.target,
        gap: p.shortfall,
        gapPct: Number(((p.shortfall / p.target) * 100).toFixed(1)),
        confidence: p.confidence,
        status: p.status,
        factors: parseFactors(p.factors)
          .sort((a, b) => a.contribution - b.contribution)
          .slice(0, 3),
      }));

    // ---- Model meta ----
    const prodMeta = metaRows.find((m) => m.key === "production_model");
    const reserveMeta = metaRows.find((m) => m.key === "reserve_model");
    const provenance = metaRows.find((m) => m.key === "data_provenance");

    const kpis = {
      lastMonthActual: lastMonth?.actual ?? 0,
      lastMonthTarget: lastMonth?.target ?? 0,
      lastMonthAchievementPct: lastMonth
        ? Number(((lastMonth.actual / lastMonth.target) * 100).toFixed(1))
        : 0,
      nextMonthPredicted: next4.reduce((a, p) => a + p.predicted, 0),
      nextMonthTarget: next4.reduce((a, p) => a + p.target, 0),
      atRiskMines: riskMines.size,
      totalMines: mines.length,
      activeRisks: predictions.filter((p) => p.status === "risk").length,
      watchCount: predictions.filter((p) => p.status === "watch").length,
      proposedRecs: proposedRecs.length,
      potentialRecovery: proposedRecs.reduce((a, r) => a + r.impactTonnes, 0),
      highPotentialCells,
      totalCells: cells.length,
      estReserveMt: Number(estReserveMt.toFixed(1)),
    };

    return {
      kpis,
      monthly,
      forecastMonths,
      topRisks,
      insights: DOMAIN_INSIGHTS,
      modelPerformance: prodMeta ? JSON.parse(prodMeta.value) : null,
      reserveModel: reserveMeta ? JSON.parse(reserveMeta.value) : null,
      provenance: provenance ? JSON.parse(provenance.value) : null,
    };
}
