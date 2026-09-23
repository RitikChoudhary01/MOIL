import { db } from "@/lib/db";
import { mineSelect, parseFactors } from "@/lib/api-utils";
import { cached } from "@/lib/api-cache";
import { guard } from "@/lib/rate-limit";
import { MineIdQuery, parseQuery, dataCacheHeaders, logApi, requestId, jsonErrorWithId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "production");
  if (blocked) return blocked;

  const q = parseQuery(MineIdQuery, request);
  if (!q.ok) return q.response;

  try {
    const payload = await cached(
      `api:production:${q.data.mineId ?? "all"}`,
      30_000,
      () => loadProduction(q.data.mineId ?? null),
    );
    logApi({ route: "/api/production", status: 200, startedAt: started, requestId: reqId, detail: { mineId: q.data.mineId ?? "all" } });
    return Response.json(payload, { headers: dataCacheHeaders() });
  } catch (e) {
    logApi({ route: "/api/production", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Failed to load production data", request);
  }
}

/**
 * Bulk-loaded variant: 3 queries total (mines, records, predictions)
 * regardless of mine count — grouped in JS instead of per-mine round trips.
 */
async function loadProduction(mineId: string | null) {
  const mines = await db.mine.findMany({
    select: mineSelect,
    orderBy: { code: "asc" },
    ...(mineId ? { where: { id: mineId } } : {}),
  });

  const [meta, allRecords, allForecasts] = await Promise.all([
    db.modelMeta.findUnique({ where: { key: "production_model" } }),
    db.productionRecord.findMany({
      where: mines.length ? { mineId: { in: mines.map((m) => m.id) } } : { mineId: "none" },
      orderBy: { weekStart: "asc" },
    }),
    db.prediction.findMany({
      where: mines.length ? { mineId: { in: mines.map((m) => m.id) } } : { mineId: "none" },
      orderBy: { weekStart: "asc" },
    }),
  ]);

  const recsByMine = new Map<string, typeof allRecords>();
  for (const r of allRecords) {
    const list = recsByMine.get(r.mineId) ?? [];
    list.push(r);
    recsByMine.set(r.mineId, list);
  }
  const fcByMine = new Map<string, typeof allForecasts>();
  for (const p of allForecasts) {
    const list = fcByMine.get(p.mineId) ?? [];
    list.push(p);
    fcByMine.set(p.mineId, list);
  }

  const minesOut = mines.map((mine) => {
    const records = recsByMine.get(mine.id) ?? [];
    const forecasts = fcByMine.get(mine.id) ?? [];

    const weekly = records.map((r) => ({
      weekStart: r.weekStart.toISOString().slice(0, 10),
      target: Math.round(r.plannedTarget),
      actual: Math.round(r.actual),
      fitted: r.fitted != null ? Math.round(r.fitted) : null,
      rainfall: Math.round(r.rainfall),
      downtime: Math.round(r.downtimeHours),
    }));

    const forecast = forecasts.map((p) => ({
      weekStart: p.weekStart.toISOString().slice(0, 10),
      horizon: p.horizon,
      predicted: p.predicted,
      target: p.target,
      confidence: p.confidence,
      status: p.status,
      shortfall: p.shortfall,
      factors: parseFactors(p.factors),
      p10: p.p10 != null ? Math.round(p.p10) : null, // 80% risk band (quantile ridge)
      p90: p.p90 != null ? Math.round(p.p90) : null,
    }));

    const last12 = records.slice(-12);
    const last12Actual = last12.reduce((a, r) => a + r.actual, 0);
    const last12Target = last12.reduce((a, r) => a + r.plannedTarget, 0);

    return {
      ...mine,
      weekly,
      forecast,
      last12AchievementPct: Number(((last12Actual / Math.max(last12Target, 1)) * 100).toFixed(1)),
    };
  });

  return {
    mines: minesOut,
    modelPerformance: meta ? JSON.parse(meta.value) : null,
  };
}
