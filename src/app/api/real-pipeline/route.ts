import { readFile } from "fs/promises";
import path from "path";
import { cached } from "@/lib/api-cache";
import { guard } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Module A (REAL) — Balaghat real-data prospectivity pipeline.
 *
 * Serves artifacts produced by scripts/real-pipeline/*.py:
 *  - results.json  : metrics ACTUALLY COMPUTED by trained models (never invented),
 *                    including the explicit circularity warning.
 *  - manifest.json : every public source URL, license and fetch timestamp.
 *
 * Provenance: every payload block is labeled (REAL PUBLIC DATA / MODEL OUTPUT / ...).
 */
const ART = path.join(process.cwd(), "research", "real-pipeline", "artifacts");

export async function GET(request: Request) {
  const blocked = guard(request, "real-pipeline");
  if (blocked) return blocked;
  try {
    const { results, manifest } = await cached("real-pipeline:artifacts", 300_000, async () => {
      const [resultsRaw, manifestRaw] = await Promise.all([
        readFile(path.join(ART, "results.json"), "utf8"),
        readFile(path.join(ART, "manifest.json"), "utf8"),
      ]);
      return { results: JSON.parse(resultsRaw), manifest: JSON.parse(manifestRaw) };
    });

    return Response.json({
      provenance: {
        data: "REAL PUBLIC DATA (USGS MRDS, GSI 1:2M geology, Copernicus DEM GLO-30, Sentinel-2 L2A, ERA5)",
        scores: "MODEL OUTPUT — manganese prospectivity, NOT certified reserves",
        metrics: "MODEL OUTPUT — computed by spatial-block cross-validation on real data",
      },
      studyArea: {
        name: "Balaghat manganese belt, Madhya Pradesh (MOIL Balaghat / Bharweli mine area)",
        aoi: results.grid?.aoi ?? null,
        cellSizeDeg: results.grid?.cell_deg ?? null,
      },
      metrics: {
        honest: {
          label: "Discovery-blind spatial block CV (no proximity feature)",
          logistic: results.logistic_block_cv_no_proximity,
          randomForest: results.random_forest_block_cv_no_proximity,
        },
        circularityTrap: {
          label: "With proximity feature — CIRCULAR (labels are distance rings)",
          logistic: results.logistic_spatial_block_cv,
          randomForest: results.random_forest_spatial_block_cv,
          warning: results.circularity_warning,
        },
        priorOnly: results.prior_only_distance_block_cv,
        classBalance: results.class_balance,
      },
      model: {
        mapModel: results.map_model,
        featureUnivariateAuc: results.feature_univariate_auc,
        logisticCoefficients: results.logistic_coefficients_std_map_model,
        randomForestImportances: results.random_forest_importances_map_model,
        tierThresholds: results.tier_thresholds,
      },
      grid: results.grid,
      topTargets: results.top_targets,
      labels: results.labels,
      validation: results.validation,
      sources: manifest.sources,
      limitations: [
        "Lithology at 1:2,000,000 scale (GSI seamless map) — regional prior, not 1:50K Bhukosh detail (geo-fenced from build sandbox; named upgrade).",
        "Labels = proximity to known MRDS occurrences — not ground-truth ore; no grade/tonnage data exists publicly.",
        "Sentinel-2 spectral indices are proxies (vegetation stress, dryness, dark-staining brightness); Sentinel-2 has no 2.3–2.4 µm band — no direct Mn mineral detection is claimed.",
        "Honest block-CV AUC ~0.61 is modest on purpose: this is the true generalization of public regional data without drill-hole labels. With MOIL/GSI private data (drill cores, 1:50K geology, geophysics) the same architecture upgrades.",
        "Prospectivity scores rank exploration priority; they never certify reserves (GSI/MCI/UNFC certification requires drilling, sampling and economic assessment).",
      ],
      runUtc: results.run_utc,
    });
  } catch (e) {
    console.error("GET /api/real-pipeline failed", e);
    return Response.json(
      { error: "Real pipeline artifacts not available. Run scripts/real-pipeline first." },
      { status: 503 },
    );
  }
}
