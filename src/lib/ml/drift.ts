// ============================================================
// Production hardening v1.2 — Data drift monitoring (PSI).
// Population Stability Index between the training window and the
// recent window, computed directly from the production warehouse.
// Industry-standard verdict bands: <0.10 stable, 0.10–0.25 moderate
// shift, >0.25 significant shift → retrain recommended.
// ============================================================

export interface PsiFeature {
  feature: string;
  psi: number;
  verdict: "stable" | "moderate" | "significant";
  expectedMean: number;
  actualMean: number;
}

export interface DriftReport {
  method: "population stability index (10 quantile bins)";
  baselineWindow: { from: string; to: string; n: number };
  recentWindow: { from: string; to: string; n: number };
  features: PsiFeature[];
  worst: PsiFeature | null;
  verdict: "stable" | "moderate" | "significant";
  retrainRecommended: boolean;
}

/** PSI between two samples using expected-window quantile bins. */
export function psi(expected: number[], actual: number[], bins = 10): number {
  const e = expected.filter((v) => Number.isFinite(v));
  const a = actual.filter((v) => Number.isFinite(v));
  if (e.length < 30 || a.length < 10) return 0; // insufficient data → no claim
  const cuts = quantileCuts(e, bins);
  const eCounts = binCounts(e, cuts);
  const aCounts = binCounts(a, cuts);
  let total = 0;
  for (let i = 0; i < eCounts.length; i++) {
    const pe = Math.max(eCounts[i] / e.length, 1e-4);
    const pa = Math.max(aCounts[i] / a.length, 1e-4);
    total += (pa - pe) * Math.log(pa / pe);
  }
  return Math.round(total * 1e4) / 1e4;
}

function quantileCuts(xs: number[], bins: number): number[] {
  const sorted = [...xs].sort((x, y) => x - y);
  const cuts: number[] = [];
  for (let i = 1; i < bins; i++) {
    const q = sorted[Math.floor((i / bins) * (sorted.length - 1))];
    if (cuts.length === 0 || q > cuts[cuts.length - 1]) cuts.push(q);
  }
  return cuts;
}

function binCounts(xs: number[], cuts: number[]): number[] {
  const counts = new Array(cuts.length + 1).fill(0);
  for (const v of xs) {
    let b = 0;
    while (b < cuts.length && v > cuts[b]) b++;
    counts[b]++;
  }
  return counts;
}

export function verdictOf(p: number): PsiFeature["verdict"] {
  return p < 0.1 ? "stable" : p < 0.25 ? "moderate" : "significant";
}

const mean = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 100) / 100 : 0;

/** Build a full drift report for Module B features from two row windows. */
export function buildDriftReport(
  baseline: Record<string, number[]>,
  recent: Record<string, number[]>,
  baselineSpan: { from: Date; to: Date },
  recentSpan: { from: Date; to: Date },
): DriftReport {
  const features: PsiFeature[] = Object.keys(baseline).map((feature) => {
    const p = psi(baseline[feature], recent[feature] ?? []);
    return {
      feature,
      psi: p,
      verdict: verdictOf(p),
      expectedMean: mean(baseline[feature]),
      actualMean: mean(recent[feature] ?? []),
    };
  });
  const worst = features.reduce<PsiFeature | null>(
    (w, f) => (!w || f.psi > w.psi ? f : w), null);
  const overall = worst ? worst.verdict : "stable";
  return {
    method: "population stability index (10 quantile bins)",
    baselineWindow: {
      from: baselineSpan.from.toISOString().slice(0, 10),
      to: baselineSpan.to.toISOString().slice(0, 10),
      n: Object.values(baseline)[0]?.length ?? 0,
    },
    recentWindow: {
      from: recentSpan.from.toISOString().slice(0, 10),
      to: recentSpan.to.toISOString().slice(0, 10),
      n: Object.values(recent)[0]?.length ?? 0,
    },
    features,
    worst,
    verdict: overall,
    retrainRecommended: overall === "significant",
  };
}
