import { db } from "@/lib/db";
import { mineSelect } from "@/lib/api-utils";
import { dataCacheHeaders, logApi, requestId, jsonErrorWithId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  try {
    const mines = await db.mine.findMany({
      select: mineSelect,
      orderBy: { code: "asc" },
    });
    logApi({ route: "/api/mines", status: 200, startedAt: started, requestId: reqId, detail: { count: mines.length } });
    return Response.json({ mines }, { headers: dataCacheHeaders(30, 120) });
  } catch (e) {
    logApi({ route: "/api/mines", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Failed to load mines", request);
  }
}
