import { db } from "@/lib/db";
import { mineSelect, cellTonnage } from "@/lib/api-utils";
import { cached } from "@/lib/api-cache";
import { guard } from "@/lib/rate-limit";
import { MineIdQuery, parseQuery, dataCacheHeaders, logApi, requestId, jsonErrorWithId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "reserve-map");
  if (blocked) return blocked;

  const q = parseQuery(MineIdQuery, request);
  if (!q.ok) return q.response;

  try {
    const payload = await cached(
      `api:reserve-map:${q.data.mineId ?? "all"}`,
      60_000,
      () => loadReserveMap(q.data.mineId ?? null),
    );
    logApi({ route: "/api/reserve-map", status: 200, startedAt: started, requestId: reqId, detail: { mineId: q.data.mineId ?? "all" } });
    return Response.json(payload, { headers: dataCacheHeaders(30, 120) });
  } catch (e) {
    logApi({ route: "/api/reserve-map", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Failed to load reserve map", request);
  }
}

async function loadReserveMap(mineId: string | null) {
    const mines = await db.mine.findMany({
      select: mineSelect,
      orderBy: { code: "asc" },
      ...(mineId ? { where: { id: mineId } } : {}),
    });

    const meta = await db.modelMeta.findUnique({ where: { key: "reserve_model" } });

    const minesOut = await Promise.all(
      mines.map(async (mine) => {
        const cells = await db.reserveCell.findMany({
          where: { mineId: mine.id },
          orderBy: [{ row: "asc" }, { col: "asc" }],
        });
        const highPotential = cells.filter((c) => c.probability > 0.6).length;
        const estTonnes =
          cells.reduce((a, c) => a + c.probability, 0) * cellTonnage(mine.oreGrade);
        const avgProb =
          cells.length > 0
            ? cells.reduce((a, c) => a + c.probability, 0) / cells.length
            : 0;
        // Top drill targets: highest-probability unconfirmed cells
        const drillTargets = [...cells]
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 5)
          .map((c) => ({
            row: c.row,
            col: c.col,
            lat: Number(c.lat.toFixed(5)),
            lng: Number(c.lng.toFixed(5)),
            probability: Number(c.probability.toFixed(3)),
            rockMatch: Number(c.rockMatch.toFixed(2)),
            distToOre: Number(c.distToOre.toFixed(2)),
            ndvi: Number(c.ndvi.toFixed(2)),
          }));
        return {
          ...mine,
          cells: cells.map((c) => ({
            row: c.row,
            col: c.col,
            lat: c.lat,
            lng: c.lng,
            ndvi: c.ndvi,
            soilMoisture: c.soilMoisture,
            lst: c.lst,
            rockMatch: c.rockMatch,
            distToOre: c.distToOre,
            probability: c.probability,
          })),
          stats: {
            totalCells: cells.length,
            highPotential,
            avgProb: Number(avgProb.toFixed(3)),
            estMt: Number(estTonnes.toFixed(2)),
            drillTargets,
          },
        };
      }),
    );

    return {
      mines: minesOut,
      modelInfo: meta ? JSON.parse(meta.value) : null,
    };
}
