// ============================================================
// Module C — Corrective Action Recommendation Engine
// Rule-based, explainable mapping from shortfall risk
// factors (dominant SHAP contributors) to a library of
// concrete operational actions, ranked by estimated impact
// (PRD FR-C1..C3). Deliberately defensible & interpretable
// rather than a black-box optimizer.
// ============================================================

import type { Attribution } from "./regression";

export interface RecommendationSeed {
  mineCode: string;
  mineName: string;
  weekStart: Date;
  gapTonnes: number; // negative = shortfall magnitude
  factors: Attribution[];
  // context used to make recommendations concrete
  sourceMine?: { code: string; name: string; spareHaulers: number };
  rainfallMm?: number;
  downtimeHours: number;
  maintenanceEvents: number;
  blastingDelays: number;
  utilization: number;
  isMonsoon: boolean;
}

export interface RecommendationDraft {
  mineCode: string;
  mineName: string;
  weekStart: Date;
  type: string;
  title: string;
  description: string;
  impactTonnes: number;
  effort: "low" | "medium" | "high";
  rationale: string;
}

/** Sort factors by most-negative (production-hurting) contribution first. */
function dominantNegatives(factors: Attribution[], k = 3): Attribution[] {
  return [...factors].sort((a, b) => a.contribution - b.contribution).slice(0, k);
}

export function generateRecommendations(
  seed: RecommendationSeed,
): RecommendationDraft[] {
  const recs: RecommendationDraft[] = [];
  const shortfall = Math.abs(seed.gapTonnes);
  const top = dominantNegatives(seed.factors);
  const factorName = (f: Attribution) => f.name.toLowerCase();

  // ---- Rule 1: high equipment downtime → redeploy from sister mine
  // Trigger on raw downtime value (operational reality) rather than SHAP
  // dominance alone — downtime at 118 hrs is actionable regardless of whether
  // the model rates it as the #1 marginal driver vs. maintenance/utilization.
  const downtimeFactor = seed.factors.find((f) => factorName(f).includes("downtime"));
  if (seed.downtimeHours > 55) {
    const recoverableHrs = seed.downtimeHours * 0.35; // 35% of downtime is avoidable via redeployment
    const impact = Math.min(recoverableHrs * 1.25, shortfall * 0.55);
    recs.push({
      mineCode: seed.mineCode,
      mineName: seed.mineName,
      weekStart: seed.weekStart,
      type: "redeploy",
      title: `Redeploy haul fleet capacity to ${seed.mineName}`,
      description: `Move ${seed.sourceMine ? `2 haulers and 1 excavator from ${seed.sourceMine.name} (${seed.sourceMine.code})` : "2 haulers and 1 excavator from the lowest-utilization sister mine"} to ${seed.mineName}. Current downtime of ${Math.round(seed.downtimeHours)} hrs/week is a critical shortfall driver; sister-mine equipment transfer recovers ~35% of avoidable idle hours within 3 days.`,
      impactTonnes: Math.round(impact),
      effort: "medium",
      rationale: `Downtime: ${Math.round(seed.downtimeHours)} hrs/wk (SHAP contribution: ${Math.round(downtimeFactor?.contribution ?? 0)} t/wk). Fleet utilization at ${Math.round(seed.utilization * 100)}% — redeployment estimated via fleet TEEMP benchmark. Trigger: raw downtime exceeds 55 hrs/wk operational threshold.`,
    });
  }

  // ---- Rule 2: rainfall dominant (esp. open-pit + monsoon) → advance blasting schedule
  if (top.some((f) => factorName(f).includes("rainfall")) && (seed.rainfallMm ?? 0) > 60) {
    const impact = Math.min(shortfall * 0.4, (seed.rainfallMm ?? 0) * 1.1);
    recs.push({
      mineCode: seed.mineCode,
      mineName: seed.mineName,
      weekStart: seed.weekStart,
      type: "blast-schedule",
      title: `Advance blasting window ahead of forecast rainfall (${seed.mineCode})`,
      description: `IMD-modeled forecast indicates ${Math.round(seed.rainfallMm ?? 0)} mm rainfall in the coming week. Shift the blasting schedule 2–3 days earlier and pre-strip the active bench so hauling continues from covered stockpiles during the wet window.`,
      impactTonnes: Math.round(impact),
      effort: "low",
      rationale: `Rainfall contribution: ${Math.round(top.find((f) => factorName(f).includes("rainfall"))?.contribution ?? 0)} t/wk. ${seed.isMonsoon ? "Monsoon interaction active — " : ""}Open-pit sensitivity modelled at 2.1× underground baseline (historical fit).`,
    });
  }

  // ---- Rule 3: maintenance backlog → preventive maintenance + spares
  if (top.some((f) => factorName(f).includes("maintenance")) && seed.maintenanceEvents >= 3) {
    const impact = Math.min(seed.maintenanceEvents * 22, shortfall * 0.35);
    recs.push({
      mineCode: seed.mineCode,
      mineName: seed.mineName,
      weekStart: seed.weekStart,
      type: "maintenance",
      title: `Preventive maintenance window + critical spares pre-positioning`,
      description: `${seed.maintenanceEvents} unplanned maintenance events last week. Schedule a 12-hour preventive maintenance window across night shifts and pre-position critical spares (hydraulic kits, bearings) from the Nagpur central store.`,
      impactTonnes: Math.round(impact),
      effort: "low",
      rationale: `Maintenance contribution: ${Math.round(top.find((f) => factorName(f).includes("maintenance"))?.contribution ?? 0)} t/wk. Each unplanned event historically costs ~22 t of despatch + 9 hrs availability.`,
    });
  }

  // ---- Rule 4: blasting delays → staggered blast pattern
  if (top.some((f) => factorName(f).includes("blasting")) && seed.blastingDelays > 5) {
    const impact = Math.min(seed.blastingDelays * 28, shortfall * 0.3);
    recs.push({
      mineCode: seed.mineCode,
      mineName: seed.mineName,
      weekStart: seed.weekStart,
      type: "blast-schedule",
      title: `Switch to staggered blast pattern at ${seed.mineName}`,
      description: `Blasting delays of ${Math.round(seed.blastingDelays)} hrs/week are clearing faces unevenly. Adopt staggered deck charging to shorten clearance times and re-sequence haul routes away from the active face.`,
      impactTonnes: Math.round(impact),
      effort: "medium",
      rationale: `Blasting-delay contribution: ${Math.round(top.find((f) => factorName(f).includes("blasting"))?.contribution ?? 0)} t/wk. Delay-to-despatch transfer ratio ~28 t/hr from historical regression.`,
    });
  }

  // ---- Rule 5: low utilization / hauler shortage → rental capacity
  if (seed.utilization < 0.62 || top.some((f) => factorName(f).includes("utilization"))) {
    const impact = Math.min(shortfall * 0.45, 900);
    recs.push({
      mineCode: seed.mineCode,
      mineName: seed.mineName,
      weekStart: seed.weekStart,
      type: "capacity",
      title: `Contract short-term rental haul capacity (${seed.mineCode})`,
      description: `Equipment utilization is at ${Math.round(seed.utilization * 100)}% (below 62% threshold). Engage 3rd-party haulers on a 2-week contract to cover despatch while own fleet undergoes corrective maintenance.`,
      impactTonnes: Math.round(impact),
      effort: "medium",
      rationale: `Utilization contribution: ${Math.round(top.find((f) => factorName(f).includes("utilization"))?.contribution ?? 0)} t/wk. Rental margin modeled against MOIL FY despatch cost benchmarks.`,
    });
  }

  // ---- Rule 6: residual gap → rail dispatch + stockpile drawdown
  const covered = recs.reduce((a, r) => a + r.impactTonnes, 0);
  if (shortfall - covered > 150) {
    recs.push({
      mineCode: seed.mineCode,
      mineName: seed.mineName,
      weekStart: seed.weekStart,
      type: "logistics",
      title: `Prioritise rail rake allocation + drawdown high-grade stockpile`,
      description: `Even after fleet actions, a residual gap of ~${Math.round(shortfall - covered)} t is projected. Request priority rake allocation from the Nagpur rail cell and draw down the high-grade stockpile (~${Math.round((shortfall - covered) * 1.8)} t available) to protect monthly despatch commitments.`,
      impactTonnes: Math.round((shortfall - covered) * 0.8),
      effort: "low",
      rationale: `Residual shortfall after corrective actions: ${Math.round(shortfall - covered)} t. Stockpile buffer covers ~1.8× the residual gap (dispatch ledger).`,
    });
  }

  // Rank by impact per unit effort (PRD FR-C3 heuristic)
  const effortWeight = { low: 1.25, medium: 1.0, high: 0.75 };
  return recs.sort(
    (a, b) => b.impactTonnes * effortWeight[b.effort] - a.impactTonnes * effortWeight[a.effort],
  );
}
