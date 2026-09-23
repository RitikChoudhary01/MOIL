import { db } from "@/lib/db";
import { cached, cacheInvalidate } from "@/lib/api-cache";
import { guard } from "@/lib/rate-limit";
import { MineIdQuery, parseQuery, dataCacheHeaders, logApi, requestId, jsonErrorWithId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "recommendations");
  if (blocked) return blocked;

  const q = parseQuery(MineIdQuery, request);
  if (!q.ok) return q.response;

  try {
    const recommendations = await cached(
      `api:recommendations:${q.data.mineId ?? "all"}`,
      15_000,
      async () => {
        const rows = await db.recommendation.findMany({
          where: q.data.mineId ? { mineId: q.data.mineId } : undefined,
          include: { mine: true },
          orderBy: { priority: "asc" },
        });
        return rows.map((r) => ({
          id: r.id,
          mineId: r.mineId,
          mineCode: r.mine.code,
          mineName: r.mine.name,
          mineType: r.mine.type,
          weekStart: r.weekStart.toISOString().slice(0, 10),
          type: r.type,
          title: r.title,
          description: r.description,
          impactTonnes: r.impactTonnes,
          effort: r.effort,
          priority: r.priority,
          rationale: r.rationale,
          status: r.status,
        }));
      },
    );

    logApi({ route: "/api/recommendations", status: 200, startedAt: started, requestId: reqId, detail: { count: recommendations.length } });
    return Response.json({ recommendations }, { headers: dataCacheHeaders() });
  } catch (e) {
    logApi({ route: "/api/recommendations", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Failed to load recommendations", request);
  }
}

export async function PATCH(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "recommendations:patch", 30, 5);
  if (blocked) return blocked;
  try {
    const body = (await request.json()) as { id?: string; status?: string };
    const allowed = ["proposed", "accepted", "rejected", "applied"];
    if (!body.id || !body.status || !allowed.includes(body.status)) {
      return Response.json(
        { error: `Body must be { id: string, status: ${allowed.join(" | ")} }` },
        { status: 400 },
      );
    }
    const existing = await db.recommendation.findUnique({ where: { id: body.id } });
    if (!existing) {
      return Response.json({ error: "Recommendation not found" }, { status: 404 });
    }
    const updated = await db.recommendation.update({
      where: { id: body.id },
      data: { status: body.status },
      include: { mine: true },
    });
    // mutation → invalidate dependent cached reads
    cacheInvalidate("api:recommendations");
    cacheInvalidate("api:overview");
    logApi({ route: "/api/recommendations:PATCH", status: 200, startedAt: started, requestId: reqId, detail: { id: body.id, status: body.status } });
    return Response.json({
      recommendation: {
        id: updated.id,
        mineCode: updated.mine.code,
        mineName: updated.mine.name,
        status: updated.status,
        impactTonnes: updated.impactTonnes,
      },
    });
  } catch (e) {
    logApi({ route: "/api/recommendations:PATCH", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Failed to update recommendation", request);
  }
}
