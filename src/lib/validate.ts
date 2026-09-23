// ============================================================
// Production hardening — request validation (zod), typed query
// parsing, cache headers and structured request logging.
// Every API route funnels user input through these helpers so
// malformed params return a clean 400 instead of a 500.
// ============================================================

import { z } from "zod";

/** Prisma cuid() ids: lowercase alphanumeric, 20–32 chars. */
const cuidLike = z
  .string()
  .regex(/^[a-z0-9]{20,32}$/, "expected a valid record id");

/** Turn "" / null into undefined so `.optional()` behaves as "all". */
const emptyToUndef = (v: unknown) => (v === "" || v == null ? undefined : v);

export const MineIdQuery = z.object({
  mineId: z.preprocess(emptyToUndef, cuidLike.optional()),
});
export type MineIdQuery = z.infer<typeof MineIdQuery>;

/** MOIL mine codes are exactly 4 uppercase letters (BLGT, MNSR, …). */
export const MineCodeQuery = z.object({
  mineCode: z.preprocess(
    (v) => {
      if (v === "" || v == null) return undefined;
      return String(v).toUpperCase();
    },
    z
      .string()
      .regex(/^[A-Z]{4}$/, "mineCode must be a 4-letter mine code (e.g. BLGT)")
      .optional(),
  ),
});
export type MineCodeQuery = z.infer<typeof MineCodeQuery>;

export const ExportQuery = z.object({
  dataset: z.enum(["production", "forecasts", "recommendations", "reserves"]),
  mineCode: z.preprocess(
    (v) => {
      if (v === "" || v == null) return undefined;
      return String(v).toUpperCase();
    },
    z.string().regex(/^[A-Z]{4}$/).optional(),
  ),
});
export type ExportQuery = z.infer<typeof ExportQuery>;

// ---------- ERP ingestion contract (see /api/ingest/spec) ----------

export const IngestRow = z.object({
  mineCode: z.string().regex(/^[A-Z]{4}$/, "mineCode must be a 4-letter code (e.g. BLGT)"),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart must be an ISO date (YYYY-MM-DD, Monday)"),
  actual: z.number().min(0).max(1_000_000),
  plannedTarget: z.number().min(0).max(1_000_000).optional(),
  rainfall: z.number().min(0).max(2000).optional(),
  downtimeHours: z.number().min(0).max(168).optional(),
  maintenanceEvents: z.number().int().min(0).max(500).optional(),
  blastingDelays: z.number().min(0).max(168).optional(),
  haulerCount: z.number().int().min(0).max(200).optional(),
  equipmentUtilization: z.number().min(0).max(1).optional(),
});
export const IngestBody = z.object({ rows: z.array(IngestRow).min(1).max(2000) });
export type IngestRow = z.infer<typeof IngestRow>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Parse + validate; on failure returns a ready-to-send 400 Response. */
export function parseWith<T>(schema: z.ZodType<T>, data: unknown): ParseResult<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    return {
      ok: false,
      response: Response.json(
        { error: "Invalid request parameters", details },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: r.data };
}

/** Parse a URL's query string against a zod object schema. */
export function parseQuery<T>(schema: z.ZodType<T>, request: Request): ParseResult<T> {
  const { searchParams } = new URL(request.url);
  const raw: Record<string, string> = {};
  searchParams.forEach((v, k) => {
    raw[k] = v;
  });
  return parseWith(schema, raw);
}

// ---------- Cache headers ----------

/** Short shared cache so browser back/forward and repeated tabs are instant. */
export const dataCacheHeaders = (maxAgeSec = 15, swrSec = 60): Record<string, string> => ({
  "Cache-Control": `public, max-age=${maxAgeSec}, stale-while-revalidate=${swrSec}`,
});

export const staticCacheHeaders = dataCacheHeaders(300, 1800); // pipeline artifacts change per run

// ---------- Structured request logging ----------

export interface ApiLogContext {
  route: string;
  status: number;
  startedAt: number;
  requestId: string;
  detail?: Record<string, unknown>;
}

export function logApi(ctx: ApiLogContext): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: ctx.status >= 500 ? "error" : "info",
    route: ctx.route,
    durMs: Date.now() - ctx.startedAt,
    status: ctx.status,
    requestId: ctx.requestId,
    ...ctx.detail,
  });
  if (ctx.status >= 500) console.error(line);
  else console.log(line);
}

/** X-Request-ID passthrough (gateway) or fresh id — echoed to clients. */
export function requestId(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID().slice(0, 8);
}

/** Standard JSON error body with request id for support triage. */
export function jsonErrorWithId(message: string, req: Request, status = 500): Response {
  return Response.json({ error: message, requestId: requestId(req) }, { status });
}
