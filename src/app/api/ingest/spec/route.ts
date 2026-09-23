// GET /api/ingest/spec — machine-readable contract for MOIL ERP integration.
// Every field is documented with type, unit and optionality so the mine
// information system team can implement the push without guesswork.
import { staticCacheHeaders } from "@/lib/validate";

export async function GET() {
  const spec = {
    version: "1.0.0",
    endpoint: { method: "POST", path: "/api/ingest/production", auth: "session cookie (role officer|admin)" },
    limits: { maxRowsPerCall: 2000, acceptedGranularity: "one row per mine per ISO week (weekStart, Monday)" },
    rowSchema: {
      mineCode: { type: "string", pattern: "^[A-Z]{4}$", description: "MOIL mine code, e.g. BLGT", required: true },
      weekStart: { type: "string", format: "ISO-8601 date", description: "Monday of the production week (UTC)", required: true },
      actual: { type: "number", unit: "tonnes", min: 0, description: "actual ore produced in the week", required: true },
      plannedTarget: { type: "number", unit: "tonnes", min: 0, description: "planned target for the week", required: false },
      rainfall: { type: "number", unit: "mm", description: "weekly rainfall. Optional: auto-filled from the REAL ERA5 archive (covers 2018-12-31 → 2026-08-24). Weeks beyond the archive MUST pass rainfall explicitly — the connector never invents weather.", required: false },
      downtimeHours: { type: "number", unit: "hours", min: 0, description: "equipment downtime", required: false },
      maintenanceEvents: { type: "integer", min: 0, description: "count of maintenance events", required: false },
      blastingDelays: { type: "number", unit: "hours", min: 0, description: "blasting delay hours", required: false },
      haulerCount: { type: "integer", min: 0, description: "active haulers", required: false },
      equipmentUtilization: { type: "number", min: 0, max: 1, description: "fraction 0..1", required: false },
    },
    response: {
      ok: "200 { ok: true, inserted, updated, skipped, auditId }",
      error: "400 validation (with per-row paths) | 401 no session | 403 insufficient role | 429 rate limit",
    },
    example: {
      curl: `curl -X POST /api/ingest/production -H 'content-type: application/json' \\\n  -d '{"rows":[{"mineCode":"BLGT","weekStart":"2026-09-07","actual":7900,"plannedTarget":8100,"downtimeHours":6.5,"maintenanceEvents":2,"blastingDelays":1,"haulerCount":11,"equipmentUtilization":0.87}]}'`,
      csvPath: "scripts/real-pipeline/sample_ingest.csv",
    },
    notes: [
      "Rows are UPSERTed on (mine, week): re-sending a corrected week is safe.",
      "INSERT of a NEW week requires the full ops picture (maintenanceEvents, blastingDelays, haulerCount, equipmentUtilization) — they feed the forecast; incomplete rows are skipped, never defaulted to fabricated values. Updates may be partial.",
      "Every accepted batch is appended to the AuditLog with actor and counts.",
      "Model caches are invalidated so forecasts reflect new data immediately.",
    ],
  };
  return Response.json(spec, { headers: staticCacheHeaders });
}
