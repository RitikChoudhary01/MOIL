import { db } from "@/lib/db";
import { parseFactors } from "@/lib/api-utils";
import { guard } from "@/lib/rate-limit";
import { MineIdQuery, parseQuery, dataCacheHeaders, logApi, requestId, jsonErrorWithId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "risks");
  if (blocked) return blocked;

  const q = parseQuery(MineIdQuery, request);
  if (!q.ok) return q.response;

  try {
    const predictions = await db.prediction.findMany({
      where: q.data.mineId ? { mineId: q.data.mineId } : undefined,
      include: { mine: true },
      orderBy: { weekStart: "asc" },
    });

    const risks = predictions
      .filter((p) => p.status !== "ok")
      .sort((a, b) => a.shortfall - b.shortfall)
      .map((p) => ({
        id: p.id,
        mineId: p.mineId,
        mineCode: p.mine.code,
        mineName: p.mine.name,
        state: p.mine.state,
        mineType: p.mine.type,
        weekStart: p.weekStart.toISOString().slice(0, 10),
        horizon: p.horizon,
        predicted: p.predicted,
        target: p.target,
        gap: p.shortfall,
        gapPct: Number(((p.shortfall / p.target) * 100).toFixed(1)),
        confidence: p.confidence,
        status: p.status,
        factors: parseFactors(p.factors).sort((a, b) => a.contribution - b.contribution),
      }));

    logApi({ route: "/api/risks", status: 200, startedAt: started, requestId: reqId, detail: { count: risks.length } });
    return Response.json({ risks }, { headers: dataCacheHeaders() });
  } catch (e) {
    logApi({ route: "/api/risks", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Failed to load risks", request);
  }
}
