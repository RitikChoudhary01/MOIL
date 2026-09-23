import { db } from "@/lib/db";
import { existsSync, statSync } from "fs";
import path from "path";
import { cacheStats } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

/**
 * Production health probe — verifies everything a live demo depends on:
 * database reachability, real-data artifacts (with freshness), and model
 * metadata. Never leaks internals; safe to expose. 200 = healthy,
 * 503 = degraded (a dependency failed).
 */
export async function GET() {
  const started = Date.now();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    const [mines, records] = await Promise.all([db.mine.count(), db.productionRecord.count()]);
    checks.database = { ok: mines > 0, detail: `${mines} mines, ${records} mine-weeks` };
  } catch {
    checks.database = { ok: false, detail: "unreachable" };
  }

  const artifacts: Record<string, string> = {
    balaghatPipeline: "research/real-pipeline/artifacts/results.json",
    multiMine: "research/multi-mine/artifacts/portfolio.json",
    modelRegistry: "models/prospectivity/model_registry.json",
  };
  for (const [name, rel] of Object.entries(artifacts)) {
    const p = path.join(process.cwd(), rel);
    if (existsSync(p)) {
      try {
        const mtime = statSync(p).mtime;
        const ageH = Math.round((Date.now() - mtime.getTime()) / 3_600_000);
        checks[name] = { ok: true, detail: `age ${ageH}h` };
      } catch {
        checks[name] = { ok: true };
      }
    } else {
      checks[name] = { ok: false, detail: "artifact missing" };
    }
  }

  // Model metadata freshness (transparency — when was Module B trained?)
  try {
    const meta = await db.modelMeta.findUnique({ where: { key: "production_model" } });
    if (meta) {
      const parsed = JSON.parse(meta.value) as { trainedAt?: string };
      checks.productionModel = {
        ok: Boolean(parsed.trainedAt),
        detail: parsed.trainedAt ? `trained ${parsed.trainedAt.slice(0, 10)}` : "no trainedAt",
      };
    } else {
      checks.productionModel = { ok: false, detail: "metadata row missing" };
    }
  } catch {
    checks.productionModel = { ok: false, detail: "unreadable" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return Response.json(
    {
      status: allOk ? "healthy" : "degraded",
      version: "1.1.0",
      service: "moil-intelligence",
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      cache: cacheStats(),
      checks,
      ts: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}
