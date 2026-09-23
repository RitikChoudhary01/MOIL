import { readFile } from "fs/promises";
import path from "path";
import { cached } from "@/lib/api-cache";
import { guard } from "@/lib/rate-limit";
import {
  MineCodeQuery,
  parseQuery,
  staticCacheHeaders,
  logApi,
  requestId,
  jsonErrorWithId,
} from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Module A (REAL, ALL 10 MINES) — regional multi-mine prospectivity.
 * Serves research/multi-mine/artifacts/portfolio.json produced by
 * scripts/real-pipeline/multi_mine_pipeline.py:
 *   - No param    → portfolio summary (per-mine stats, honest CV metrics)
 *   - ?mineCode=X → that mine's full real satellite-derived grid
 *
 * Every payload block carries provenance labels. Scores are model
 * outputs ranking exploration priority — never certified reserves.
 */

const ART = path.join(process.cwd(), "research", "multi-mine", "artifacts");
const CACHE_MS = 5 * 60 * 1000; // artifacts are static per pipeline run

type Portfolio = Record<string, unknown> & { per_mine?: Array<Record<string, unknown>> };

async function loadJson(name: string): Promise<Portfolio | null> {
  try {
    const raw = await readFile(path.join(ART, name), "utf8");
    return JSON.parse(raw) as Portfolio;
  } catch {
    return null;
  }
}

async function loadPortfolio(): Promise<Portfolio> {
  return cached("prospectivity:portfolio", CACHE_MS, async () => {
    const raw = await readFile(path.join(ART, "portfolio.json"), "utf8");
    return JSON.parse(raw) as Portfolio;
  });
}

async function loadV1Backup(): Promise<Portfolio | null> {
  return cached("prospectivity:v1backup", CACHE_MS, async () => loadJson("portfolio_v1_backup.json"));
}

export async function GET(request: Request) {
  const started = Date.now();
  const reqId = requestId(request);
  const blocked = guard(request, "prospectivity");
  if (blocked) return blocked;

  const q = parseQuery(MineCodeQuery, request);
  if (!q.ok) return q.response;
  const mineCode = q.data.mineCode;

  try {
    const portfolio = await loadPortfolio();
    const v1 = await loadV1Backup();
    const perMine = (portfolio.per_mine ?? []) as Array<Record<string, unknown>>;

    const provenance = {
      data: "REAL PUBLIC DATA (USGS MRDS, GSI 1:2M geology, Copernicus DEM GLO-30, Sentinel-2 L2A)",
      scores: "MODEL OUTPUT — manganese prospectivity ranking, NOT certified reserves",
      metrics: "MODEL OUTPUT — discovery-blind spatial block CV, proximity feature excluded",
    };

    if (mineCode) {
      const mine = perMine.find((m) => m.code === mineCode);
      if (!mine || (mine.cellsTotal ?? 0) === 0) {
        logApi({ route: "/api/prospectivity", status: 404, startedAt: started, requestId: reqId, detail: { mineCode } });
        return Response.json(
          { error: `No real grid available for mine '${mineCode}'.` },
          { status: 404 },
        );
      }
      logApi({ route: "/api/prospectivity", status: 200, startedAt: started, requestId: reqId, detail: { mineCode } });
      return Response.json(
        {
          provenance,
          mine,
          model: {
            modelVersion: portfolio.model_version,
            ensemble: portfolio.map_model,
            honestCv: portfolio.honest_cv,
            reliabilityBins: portfolio.reliability_bins,
            featureUnivariateAuc: portfolio.feature_univariate_auc,
            modelRegistry: portfolio.model_registry,
          },
          labelRule: portfolio.label_rule,
          runUtc: portfolio.run_utc,
        },
        { headers: staticCacheHeaders },
      );
    }

    // Portfolio summary — strip heavy cell arrays
    const summaries = perMine.map(({ cells, nearSites, ...rest }) => ({
      ...rest,
      nearSitesCount: Array.isArray(nearSites) ? nearSites.length : 0,
    }));
    logApi({ route: "/api/prospectivity", status: 200, startedAt: started, requestId: reqId });
    return Response.json(
      {
        provenance,
        region: portfolio.region,
        modelVersion: portfolio.model_version,
        classBalance: portfolio.class_balance,
        honestCv: portfolio.honest_cv,
        // v1 honesty demo (circularity trap) — kept from the archived v1 run,
        // explicitly labeled: the v2 map NEVER uses the proximity feature
        circularCv: v1?.circular_cv ?? null,
        randomKfold: v1?.random_kfold ?? null,
        circularCvNote:
          "v1 demonstration only — exposing the leakage trap; v2 scores exclude proximity entirely",
        mapModel: portfolio.map_model,
        reliabilityBins: portfolio.reliability_bins,
        featureUnivariateAuc: portfolio.feature_univariate_auc,
        mines: summaries,
        sentinelScenes: portfolio.sentinel_scenes,
        modelRegistry: portfolio.model_registry,
        limitations: [
          "Lithology at 1:2,000,000 scale (GSI seamless map) — regional prior.",
          "Labels = proximity to known MRDS occurrences — not ground-truth ore; no public grade/tonnage data.",
          "Sentinel-2 proxies (vegetation stress, dryness, brightness, alteration ratios); no direct Mn mineral detection claimed (no 2.3–2.4 µm band).",
          "Honest block-CV AUC is the true generalization without drill-hole labels; MOIL/GSI private data upgrades the same architecture.",
        ],
        runUtc: portfolio.run_utc,
      },
      { headers: staticCacheHeaders },
    );
  } catch (e) {
    logApi({ route: "/api/prospectivity", status: 503, startedAt: started, requestId: reqId });
    return jsonErrorWithId(
      "Multi-mine artifacts not available. Run scripts/real-pipeline/multi_mine_pipeline.py first.",
      request,
      503,
    );
  }
}
