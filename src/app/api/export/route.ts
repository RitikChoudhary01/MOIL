import { db } from "@/lib/db";
import { parseFactors } from "@/lib/api-utils";
import { guard } from "@/lib/rate-limit";
import { ExportQuery, parseQuery, logApi, requestId, jsonErrorWithId } from "@/lib/validate";
import { toCsv, csvHeaders } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * GET /api/export?dataset=production|forecasts|recommendations|reserves
 * [&mineCode=XXXX]
 *
 * CSV export for offline analysis / jury handouts. Streams the same
 * data the dashboard renders — no separate export logic to drift.
 */
export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "export", 30, 5);
  if (blocked) return blocked;

  const q = parseQuery(ExportQuery, request);
  if (!q.ok) return q.response;
  const { dataset, mineCode } = q.data;

  try {
    let csv: string;
    let filename: string;

    if (dataset === "production") {
      const mines = await db.mine.findMany({
        orderBy: { code: "asc" },
        ...(mineCode ? { where: { code: mineCode } } : {}),
      });
      const records = await db.productionRecord.findMany({
        where: mines.length ? { mineId: { in: mines.map((m) => m.id) } } : { mineId: "none" },
        orderBy: [{ mineId: "asc" }, { weekStart: "asc" }],
      });
      const mineById = new Map(mines.map((m) => [m.id, m]));
      csv = toCsv(
        records.map((r) => {
          const m = mineById.get(r.mineId);
          return {
            mine_code: m?.code ?? "",
            mine_name: m?.name ?? "",
            mine_type: m?.type ?? "",
            state: m?.state ?? "",
            week_start: r.weekStart.toISOString().slice(0, 10),
            planned_target_t: Math.round(r.plannedTarget),
            actual_t: Math.round(r.actual),
            fitted_t: r.fitted != null ? Math.round(r.fitted) : "",
            rainfall_mm: r.rainfall,
            downtime_hrs: r.downtimeHours,
            maintenance_events: r.maintenanceEvents,
            blasting_delays_hrs: r.blastingDelays,
            active_haulers: r.haulerCount,
            equipment_utilization: r.equipmentUtilization,
            soil_moisture: r.soilMoisture ?? "",
            temp_c: r.tempC ?? "",
            weather_provenance: "REAL ERA5 (Open-Meteo, CC-BY-4.0)",
            ops_provenance: "SYNTHETIC (anchored to MOIL public aggregates)",
          };
        }),
      );
      filename = `moil_production_${mineCode ?? "all"}.csv`;
    } else if (dataset === "forecasts") {
      const mines = await db.mine.findMany({
        orderBy: { code: "asc" },
        ...(mineCode ? { where: { code: mineCode } } : {}),
      });
      const preds = await db.prediction.findMany({
        where: mines.length ? { mineId: { in: mines.map((m) => m.id) } } : { mineId: "none" },
        orderBy: [{ mineId: "asc" }, { horizon: "asc" }],
        include: { mine: true },
      });
      csv = toCsv(
        preds.map((p) => ({
          mine_code: p.mine.code,
          mine_name: p.mine.name,
          week_start: p.weekStart.toISOString().slice(0, 10),
          horizon_wk: p.horizon,
          predicted_t: p.predicted,
          target_t: p.target,
          shortfall_t: p.shortfall,
          confidence: p.confidence,
          status: p.status,
          shap_factors: parseFactors(p.factors)
            .map((f) => `${f.name}=${f.value}${f.contribution < 0 ? "-" : "+"}${Math.abs(Math.round(f.contribution))}t`)
            .join("; "),
          model: "Ridge regression, rolling-origin CV (R2 0.928, MAPE 11.6%)",
        })),
      );
      filename = `moil_forecasts_${mineCode ?? "all"}.csv`;
    } else if (dataset === "recommendations") {
      const recs = await db.recommendation.findMany({
        where: mineCode ? { mine: { code: mineCode } } : undefined,
        orderBy: [{ priority: "asc" }],
        include: { mine: true },
      });
      csv = toCsv(
        recs.map((r) => ({
          priority: r.priority,
          mine_code: r.mine.code,
          mine_name: r.mine.name,
          week_start: r.weekStart.toISOString().slice(0, 10),
          type: r.type,
          title: r.title,
          description: r.description,
          impact_tonnes: r.impactTonnes,
          effort: r.effort,
          status: r.status,
          rationale: r.rationale,
        })),
      );
      filename = `moil_recommendations_${mineCode ?? "all"}.csv`;
    } else {
      // reserves — demo-mode Module A grid (labeled as such)
      const mines = await db.mine.findMany({
        orderBy: { code: "asc" },
        ...(mineCode ? { where: { code: mineCode } } : {}),
      });
      const cells = await db.reserveCell.findMany({
        where: mines.length ? { mineId: { in: mines.map((m) => m.id) } } : { mineId: "none" },
        orderBy: [{ mineId: "asc" }, { row: "asc" }, { col: "asc" }],
        include: { mine: true },
      });
      csv = toCsv(
        cells.map((c) => ({
          mine_code: c.mine.code,
          row: c.row,
          col: c.col,
          lat: c.lat.toFixed(5),
          lng: c.lng.toFixed(5),
          ndvi: c.ndvi,
          soil_moisture: c.soilMoisture,
          lst_c: c.lst,
          rock_match: c.rockMatch,
          dist_to_ore_km: c.distToOre,
          probability: c.probability,
          provenance: "DEMO MODE — synthetic labels; see /api/prospectivity for the REAL pipeline",
        })),
      );
      filename = `moil_reserve_cells_${mineCode ?? "all"}.csv`;
    }

    logApi({ route: "/api/export", status: 200, startedAt: started, requestId: reqId, detail: { dataset, mineCode: mineCode ?? "all", bytes: csv.length } });
    return new Response(csv, { headers: csvHeaders(filename) });
  } catch (e) {
    logApi({ route: "/api/export", status: 500, startedAt: started, requestId: reqId, detail: { dataset } });
    return jsonErrorWithId("Export failed", request);
  }
}
