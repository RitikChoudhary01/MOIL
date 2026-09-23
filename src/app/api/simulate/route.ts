import { cached } from "@/lib/api-cache";
import { guard } from "@/lib/rate-limit";
import { trainProductionModel, simulateScenario, type ProductionModelBundle, type ScenarioOverrides } from "@/lib/ml/scenario";
import { parseWith, logApi, requestId, jsonErrorWithId } from "@/lib/validate";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * POST /api/simulate — what-if production scenario for one mine.
 *
 * Body: { mineId: string, overrides?: {
 *   downtimeHours?, maintenanceEvents?, blastingDelays?,
 *   haulerCount?, equipmentUtilization?, rainfallMm?
 * } }
 *
 * The ridge model is refit from the warehouse (deterministic, memoized
 * 10 min) so the counterfactual always reflects the latest data.
 */
const SimulateBody = z.object({
  mineId: z.string().regex(/^[a-z0-9]{20,32}$/, "expected a valid mine id"),
  overrides: z
    .object({
      downtimeHours: z.number().min(0).max(336).optional(),
      maintenanceEvents: z.number().min(0).max(30).optional(),
      blastingDelays: z.number().min(0).max(72).optional(),
      haulerCount: z.number().min(0).max(30).optional(),
      equipmentUtilization: z.number().min(0).max(1).optional(),
      rainfallMm: z.number().min(0).max(500).optional(),
    })
    .default({}),
});

// Model refit is ~1s of CPU — memoize so concurrent sliders never retrain.
const MODEL_TTL = 10 * 60 * 1000;
async function getModel(): Promise<ProductionModelBundle> {
  return cached("ml:production-model", MODEL_TTL, trainProductionModel);
}

export async function POST(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "simulate", 60, 10);
  if (blocked) return blocked;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const parsed = parseWith(SimulateBody, raw);
  if (!parsed.ok) return parsed.response;

  try {
    const bundle = await getModel();
    const result = simulateScenario(bundle, parsed.data.mineId, parsed.data.overrides as ScenarioOverrides);
    if (!result) {
      return Response.json({ error: "Unknown mineId — no scenario context for this mine." }, { status: 404 });
    }
    logApi({
      route: "/api/simulate",
      status: 200,
      startedAt: started,
      requestId: reqId,
      detail: { mine: result.mine.code, deltaT: result.delta.tonnes },
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    logApi({ route: "/api/simulate", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Scenario simulation failed", request);
  }
}

/** GET returns slider metadata (ranges) so the UI never hard-codes limits. */
export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "simulate", 60, 10);
  if (blocked) return blocked;
  try {
    const bundle = await getModel();
    const mines = [...bundle.contexts.values()].map((c) => ({
      mineId: c.mineId,
      code: c.code,
      name: c.name,
      type: c.type,
      baselineWeek: c.baselineWeek,
      baselineValues: c.baselineValues,
      ranges: c.ranges,
    }));
    logApi({ route: "/api/simulate", status: 200, startedAt: started, requestId: reqId });
    return Response.json(
      { mines, metrics: bundle.metrics },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (e) {
    logApi({ route: "/api/simulate", status: 500, startedAt: started, requestId: reqId });
    return jsonErrorWithId("Scenario metadata unavailable", request);
  }
}
