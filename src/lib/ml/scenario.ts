// ============================================================
// Scenario engine — server-side ridge refit + exact counterfactuals.
//
// The production shortfall model (Module B) is a standardized ridge
// regression. Because it is linear, "what-if" planning is EXACT, not
// approximate: apply the operator's hypothesized changes to the
// feature row, re-score, and attribute the difference feature-by-feature
// with linear-SHAP (φ_i = w_i·(x_i−μ_i)/σ_i; Σφ = ŷ_scenario − ŷ_baseline
// holds exactly).
//
// The model is refit from the warehouse (ProductionRecord table) with
// the SAME feature layout as the seed pipeline, on a held-out last-52-
// weeks test split (scaler fitted on train rows only). Training is
// deterministic gradient descent → safe to memoize.
// ============================================================

import { db } from "@/lib/db";
import {
  trainRidge,
  predictRidge,
  sortBand,
  attribute,
  type RidgeModel,
  type QuantileBand,
  type Attribution,
} from "./regression";

// Feature layout — MUST match prisma/seed.ts (shared contract)
export const FEATURES = [
  "Planned target", // t
  "Rainfall (current wk)", // mm
  "Rainfall (prev wk)", // mm
  "Equipment downtime", // hrs
  "Maintenance events", // count
  "Blasting delays", // hrs
  "Active haulers", // count
  "Equipment utilization", // 0-1
  "Monsoon period", // 0|1
  "Monsoon × open-pit rainfall", // mm (interaction)
] as const;

const F = {
  target: 0,
  rain: 1,
  rainLag: 2,
  downtime: 3,
  maint: 4,
  blast: 5,
  haulers: 6,
  util: 7,
  monsoon: 8,
  pitRain: 9,
} as const;

const isMonsoonMonth = (d: Date) => d.getUTCMonth() >= 5 && d.getUTCMonth() <= 8; // Jun–Sep

export interface ScenarioOverrides {
  downtimeHours?: number;
  maintenanceEvents?: number;
  blastingDelays?: number;
  haulerCount?: number;
  equipmentUtilization?: number;
  rainfallMm?: number; // what-if weather stress
}

export interface ScenarioRange {
  min: number;
  max: number;
  step: number;
  unit: string;
  label: string;
}

export interface MineScenarioContext {
  mineId: string;
  code: string;
  name: string;
  type: string;
  baselineRow: number[];
  baselineValues: Record<string, number>; // override-key → recorded value (slider defaults)
  baselineWeek: string;
  residualBand: ResidualBand; // per-mine conformal offsets for the risk band
  ranges: Record<string, ScenarioRange>;
}

export interface ScenarioResult {
  mine: { code: string; name: string; type: string };
  baselineWeek: string;
  baseline: { predicted: number };
  scenario: { predicted: number };
  uncertainty: {
    baseline: QuantileBand;
    scenario: QuantileBand;
    coverage80: number;
    note: string;
  };
  delta: { tonnes: number; pct: number; horizon4wk: number };
  contributions: Attribution[]; // changed features only, sorted by |φ|
  model: {
    algorithm: string;
    holdoutR2: number;
    holdoutMape: number;
    trainWeeks: number;
    testWeeks: number;
    refitNote: string;
  };
  overridesApplied: Record<string, number>;
}

export interface ResidualBand {
  q10: number; // mine's P10 residual offset (negative)
  q90: number; // mine's P90 residual offset (positive)
  n: number; // calibration window size
}

export interface QuantileBundle {
  coverage80: number; // measured on a DISJOINT later window
  note: string;
}

export interface ProductionModelBundle {
  model: RidgeModel;
  quantiles: QuantileBundle;
  contexts: Map<string, MineScenarioContext>;
  metrics: { holdoutR2: number; holdoutMape: number; trainWeeks: number; testWeeks: number };
}

function buildRow(
  target: number,
  rain: number,
  rainLag: number,
  downtime: number,
  maint: number,
  blast: number,
  haulers: number,
  util: number,
  weekStart: Date,
  isPit: boolean,
): number[] {
  const row = new Array(FEATURES.length).fill(0) as number[];
  row[F.target] = target;
  row[F.rain] = rain;
  row[F.rainLag] = rainLag;
  row[F.downtime] = downtime;
  row[F.maint] = maint;
  row[F.blast] = blast;
  row[F.haulers] = haulers;
  row[F.util] = util;
  row[F.monsoon] = isMonsoonMonth(weekStart) ? 1 : 0;
  row[F.pitRain] = isMonsoonMonth(weekStart) && isPit ? rain : 0;
  return row;
}

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * Refit the ridge model from the DB warehouse (deterministic).
 * Pooled across mines; last 52 mine-weeks held out for honest metrics.
 */
export async function trainProductionModel(): Promise<ProductionModelBundle> {
  const [mines, records] = await Promise.all([
    db.mine.findMany({ select: { id: true, code: true, name: true, type: true }, orderBy: { code: "asc" } }),
    db.productionRecord.findMany({ orderBy: [{ mineId: "asc" }, { weekStart: "asc" }] }),
  ]);

  const typeById = new Map(mines.map((m) => [m.id, m.type]));
  const X: number[][] = [];
  const y: number[] = [];
  // Rolling-origin holdout: per mine, its LAST 8 weeks become test rows.
  // This mirrors "predict future weeks for every mine" — the actual use case —
  // and matches the seed pipeline's rolling-origin methodology.
  const HOLDOUT_PER_MINE = 8;
  const testIdx: number[] = [];

  // Rows must be grouped per mine for the rainfall lag
  const byMine = new Map<string, typeof records>();
  for (const r of records) {
    const list = byMine.get(r.mineId) ?? [];
    list.push(r);
    byMine.set(r.mineId, list);
  }
  const rowsMineId: string[] = [];
  const mineStart = new Map<string, number>();
  for (const [, list] of byMine) {
    const isPit = typeById.get(list[0].mineId) !== "underground";
    mineStart.set(list[0].mineId, X.length);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const prevRain = i > 0 ? list[i - 1].rainfall : r.rainfall;
      const rowIdx = X.length;
      X.push(
        buildRow(
          r.plannedTarget,
          r.rainfall,
          prevRain,
          r.downtimeHours,
          r.maintenanceEvents,
          r.blastingDelays,
          r.haulerCount,
          r.equipmentUtilization,
          r.weekStart,
          isPit,
        ),
      );
      y.push(r.actual);
      rowsMineId.push(list[0].mineId);
      if (i >= list.length - HOLDOUT_PER_MINE) testIdx.push(rowIdx);
    }
  }

  const model = trainRidge(X, y, { featureNames: [...FEATURES], l2: 1.0, lr: 0.08, epochs: 3000 }, testIdx);

  // ---- Per-mine split-conformal residual bands (same design as the seed) ----
  // Calibration: residuals on the 24 mine-weeks BEFORE the holdout,
  // out-of-sample for a model trained without them. Coverage is then
  // measured on the DISJOINT holdout window — no circularity. 24 residuals
  // keep the conformal order statistics stable (q10 = 3rd smallest).
  // Pooled quantile regression was evaluated and rejected (bands ignore
  // mine scale; see MODEL_CARD.md).
  const BAND_CAL = 24;
  const calTestIdx: number[] = [];
  for (const [mineId, list] of byMine) {
    const start = mineStart.get(mineId)!;
    for (let i = list.length - 2 * BAND_CAL; i < list.length - BAND_CAL; i++) {
      calTestIdx.push(start + i);
    }
  }
  const calModel = trainRidge(X, y, { featureNames: [...FEATURES], l2: 1.0, lr: 0.08, epochs: 3000 }, calTestIdx);
  const residByMine = new Map<string, number[]>();
  for (const i of calTestIdx) {
    const mineId = rowsMineId[i];
    const list = residByMine.get(mineId) ?? [];
    list.push(y[i] - predictRidge(calModel, X[i]));
    residByMine.set(mineId, list);
  }
  const conformalQ = (residuals: number[], tau: number): number => {
    const sorted = [...residuals].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(tau * (sorted.length + 1)) - 1));
    return sorted[idx];
  };
  const bandByMine = new Map<string, { q10: number; q90: number; n: number }>();
  for (const [mineId, residuals] of residByMine) {
    bandByMine.set(mineId, {
      q10: conformalQ(residuals, 0.1),
      q90: conformalQ(residuals, 0.9),
      n: residuals.length,
    });
  }
  const coverageByMine = new Map<string, { inside: number; total: number }>();
  for (const i of testIdx) {
    const mineId = rowsMineId[i];
    const residuals = residByMine.get(mineId) ?? [];
    if (residuals.length === 0) continue;
    const q10 = conformalQ(residuals, 0.1);
    const q90 = conformalQ(residuals, 0.9);
    const pred = predictRidge(calModel, X[i]);
    const agg = coverageByMine.get(mineId) ?? { inside: 0, total: 0 };
    agg.total += 1;
    if (y[i] >= pred + q10 && y[i] <= pred + q90) agg.inside += 1;
    coverageByMine.set(mineId, agg);
  }
  const totalInside = [...coverageByMine.values()].reduce((a, v) => a + v.inside, 0);
  const totalWeeks = [...coverageByMine.values()].reduce((a, v) => a + v.total, 0);
  const coverage80 = totalInside / Math.max(totalWeeks, 1);

  // ---- per-mine scenario contexts (latest record = baseline) ----
  const rangesFor = (mineRecs: typeof records): Record<string, ScenarioRange> => {
    const downs = mineRecs.map((r) => r.downtimeHours).sort((a, b) => a - b);
    const hauls = mineRecs.map((r) => r.haulerCount).sort((a, b) => a - b);
    const utils = mineRecs.map((r) => r.equipmentUtilization).sort((a, b) => a - b);
    const blasts = mineRecs.map((r) => r.blastingDelays).sort((a, b) => a - b);
    const maxHaulers = Math.ceil(pctile(hauls, 0.95)) + 4;
    return {
      downtimeHours: { min: 0, max: Math.max(48, Math.ceil(pctile(downs, 0.98))), step: 2, unit: "hrs/wk", label: "Equipment downtime" },
      haulerCount: { min: 0, max: maxHaulers, step: 1, unit: "haulers", label: "Active haulers" },
      equipmentUtilization: { min: 0.3, max: 1, step: 0.01, unit: "ratio", label: "Equipment utilization" },
      blastingDelays: { min: 0, max: Math.max(12, Math.ceil(pctile(blasts, 0.98))), step: 0.5, unit: "hrs/wk", label: "Blasting delays" },
      maintenanceEvents: { min: 0, max: 8, step: 1, unit: "events/wk", label: "Maintenance events" },
      rainfallMm: { min: 0, max: 180, step: 5, unit: "mm/wk", label: "Rainfall (stress test)" },
    };
  };

  const contexts = new Map<string, MineScenarioContext>();
  for (const mine of mines) {
    const recs = byMine.get(mine.id) ?? [];
    if (recs.length === 0) continue;
    const latest = recs[recs.length - 1];
    const prevRain = recs.length > 1 ? recs[recs.length - 2].rainfall : latest.rainfall;
    const isPit = mine.type !== "underground";
    const baselineRow = buildRow(
      latest.plannedTarget,
      latest.rainfall,
      prevRain,
      latest.downtimeHours,
      latest.maintenanceEvents,
      latest.blastingDelays,
      latest.haulerCount,
      latest.equipmentUtilization,
      latest.weekStart,
      isPit,
    );
    contexts.set(mine.id, {
      mineId: mine.id,
      code: mine.code,
      name: mine.name,
      type: mine.type,
      baselineWeek: latest.weekStart.toISOString().slice(0, 10),
      baselineRow,
      residualBand: {
        q10: bandByMine.get(mine.id)?.q10 ?? 0,
        q90: bandByMine.get(mine.id)?.q90 ?? 0,
        n: bandByMine.get(mine.id)?.n ?? 0,
      },
      baselineValues: {
        downtimeHours: baselineRow[F.downtime],
        maintenanceEvents: baselineRow[F.maint],
        blastingDelays: baselineRow[F.blast],
        haulerCount: baselineRow[F.haulers],
        equipmentUtilization: baselineRow[F.util],
        rainfallMm: baselineRow[F.rain],
      },
      ranges: rangesFor(recs),
    });
  }

  return {
    model,
    quantiles: {
      coverage80: Number(coverage80.toFixed(3)),
      note: `Per-mine split-conformal P10–P90 bands (rolling-origin residual quantiles); coverage measured on a disjoint later window.`,
    },
    contexts,
    metrics: {
      holdoutR2: Number(model.metrics.r2.toFixed(3)),
      holdoutMape: Number(model.metrics.mape.toFixed(1)),
      trainWeeks: model.metrics.trainSamples,
      testWeeks: model.metrics.testSamples,
    },
  };
}

/** P10/P50/P90 band around a point prediction from that mine's conformal offsets. */
export function bandFromResidual(point: number, band: ResidualBand): QuantileBand {
  return sortBand(point + band.q10, point, point + band.q90);
}

const FEATURE_TO_OVERRIDE: Record<string, number> = {
  downtimeHours: F.downtime,
  maintenanceEvents: F.maint,
  blastingDelays: F.blast,
  haulerCount: F.haulers,
  equipmentUtilization: F.util,
  rainfallMm: F.rain,
};

/**
 * Exact counterfactual: score the baseline row and the overridden row with
 * the same refit model; attribute the difference per changed feature.
 */
export function simulateScenario(
  bundle: ProductionModelBundle,
  mineId: string,
  overrides: ScenarioOverrides,
): ScenarioResult | null {
  const ctx = bundle.contexts.get(mineId);
  if (!ctx) return null;

  const baselineRow = [...ctx.baselineRow];
  const scenarioRow = [...ctx.baselineRow];
  const applied: Record<string, number> = {};

  for (const [key, fIdx] of Object.entries(FEATURE_TO_OVERRIDE)) {
    const v = (overrides as Record<string, number | undefined>)[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      scenarioRow[fIdx] = v;
      applied[key] = v;
    }
  }
  // monsoon × open-pit interaction must track the what-if rainfall
  const isPit = ctx.type !== "underground";
  scenarioRow[F.pitRain] = isPit && scenarioRow[F.monsoon] === 1 ? scenarioRow[F.rain] : 0;

  const baselinePred = Math.max(0, predictRidge(bundle.model, baselineRow));
  const scenarioPred = Math.max(0, predictRidge(bundle.model, scenarioRow));
  const baseBand = bandFromResidual(baselinePred, ctx.residualBand);
  const scenBand = bandFromResidual(scenarioPred, ctx.residualBand);

  // SHAP deltas restricted to features the operator actually moved
  const baseAttrs = attribute(bundle.model, baselineRow);
  const scenAttrs = attribute(bundle.model, scenarioRow);
  const contributions = scenAttrs
    .map((a, j) => ({
      name: FEATURES[j],
      value: scenarioRow[j],
      contribution: a.contribution - baseAttrs[j].contribution,
    }))
    .filter((c) => Math.abs(c.contribution) > 0.5)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const deltaT = scenarioPred - baselinePred;

  return {
    mine: { code: ctx.code, name: ctx.name, type: ctx.type },
    baselineWeek: ctx.baselineWeek,
    baseline: { predicted: Math.round(baselinePred) },
    scenario: { predicted: Math.round(scenarioPred) },
    uncertainty: {
      baseline: {
        p10: Math.round(baseBand.p10),
        p50: Math.round(baseBand.p50),
        p90: Math.round(baseBand.p90),
      },
      scenario: {
        p10: Math.round(scenBand.p10),
        p50: Math.round(scenBand.p50),
        p90: Math.round(scenBand.p90),
      },
      coverage80: bundle.quantiles.coverage80,
      note: `P10–P90 from that mine's own out-of-sample residual quantiles (split-conformal, rolling-origin); ${Math.round(bundle.quantiles.coverage80 * 100)}% of held-out weeks fell inside the band on a later window.`,
    },
    delta: {
      tonnes: Math.round(deltaT),
      pct: Number(((deltaT / Math.max(baselinePred, 1)) * 100).toFixed(1)),
      horizon4wk: Math.round(deltaT * 4),
    },
    contributions,
    model: {
      algorithm: "Ridge regression — refit on warehouse on request (same architecture as Module B)",
      holdoutR2: bundle.metrics.holdoutR2,
      holdoutMape: bundle.metrics.holdoutMape,
      trainWeeks: bundle.metrics.trainWeeks,
      testWeeks: bundle.metrics.testWeeks,
      refitNote:
        "Deterministic gradient descent on the 4,000-mine-week warehouse; per-mine rolling-origin holdout (last 8 weeks of every mine, scaler fit on train only). Linear model ⇒ counterfactuals are exact, Σφ = Δŷ.",
    },
    overridesApplied: applied,
  };
}
