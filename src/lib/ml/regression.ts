// ============================================================
// ML Engine — Ridge Regression (gradient descent) with
// linear-SHAP feature attribution. Pure TypeScript, zero deps.
//
// For a standardized linear model:
//   y_hat = yMean + Σ w_i * (x_i - xMean_i) / xStd_i
// the exact SHAP value of feature i (linear model) is:
//   φ_i = w_i * (x_i - xMean_i) / xStd_i
// so contributions sum exactly to (y_hat - yMean) — fully
// explainable, which the PSU judge panel demands (PRD §6).
// ============================================================

export interface RidgeModel {
  weights: number[];
  bias: number; // yMean
  xMean: number[];
  xStd: number[];
  featureNames: string[];
  metrics: {
    r2: number;
    mae: number;
    mape: number;
    trainSamples: number;
    testSamples: number;
  };
}

/** Deterministic PRNG (mulberry32) so every seed run is reproducible for the demo. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number, mu = 0, sigma = 1): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Column-wise mean and (population) std with zero-std guard. */
function fitScaler(X: number[][]): { mean: number[]; std: number[] } {
  const n = X.length;
  const d = X[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  for (const row of X)
    for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

function standardize(X: number[][], mean: number[], std: number[]): number[][] {
  return X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));
}

export interface TrainOptions {
  featureNames: string[];
  l2?: number; // ridge penalty
  lr?: number; // learning rate
  epochs?: number;
}

/**
 * Train ridge regression via full-batch gradient descent.
 * X: [n][d] raw features, y: [n] raw targets.
 * Pass testIdx for a held-out evaluation split — the scaler is
 * fitted on TRAIN rows only (no leakage into the test metrics).
 */
export function trainRidge(
  X: number[][],
  y: number[],
  opts: TrainOptions,
  testIdx: number[] = [],
): RidgeModel {
  const { featureNames } = opts;
  const l2 = opts.l2 ?? 1.0;
  const lr = opts.lr ?? 0.08;
  const epochs = opts.epochs ?? 6000;
  const d = X[0].length;

  const testSet = new Set(testIdx);
  const trainIdx = X.map((_, i) => i).filter((i) => !testSet.has(i));
  const Xtr = trainIdx.map((i) => X[i]);
  const ytr = trainIdx.map((i) => y[i]);
  const n = Xtr.length;

  const { mean, std } = fitScaler(Xtr);
  const Xs = standardize(Xtr, mean, std);
  const yMean = ytr.reduce((a, b) => a + b, 0) / n;
  const yc = ytr.map((v) => v - yMean);

  const w = new Array(d).fill(0);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      let pred = 0;
      for (let j = 0; j < d; j++) pred += w[j] * Xs[i][j];
      const err = pred - yc[i];
      for (let j = 0; j < d; j++) grad[j] += (err * Xs[i][j]) / n;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (grad[j] + (l2 * w[j]) / n);
  }

  const predictRaw = (row: number[]) => {
    let p = yMean;
    for (let j = 0; j < d; j++) p += (w[j] * (row[j] - mean[j])) / std[j];
    return p;
  };

  // Metrics: held-out when testIdx provided, else in-sample
  const evalIdx = testIdx.length > 0 ? testIdx : X.map((_, i) => i);
  const Xev = evalIdx.map((i) => X[i]);
  const yev = evalIdx.map((i) => y[i]);
  const pev = Xev.map(predictRaw);

  return {
    weights: w,
    bias: yMean,
    xMean: mean,
    xStd: std,
    featureNames,
    metrics: {
      r2: r2Score(yev, pev),
      mae: maeScore(yev, pev),
      mape: mapeScore(yev, pev),
      trainSamples: n,
      testSamples: testIdx.length,
    },
  };
}

export function predictRidge(model: RidgeModel, row: number[]): number {
  let p = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    p += (model.weights[j] * (row[j] - model.xMean[j])) / model.xStd[j];
  }
  return p;
}

export interface Attribution {
  name: string;
  value: number; // raw feature value
  contribution: number; // tonnes (negative hurts production)
}

/** Linear-SHAP attribution: φ_i = w_i * (x_i - mean_i)/std_i */
export function attribute(model: RidgeModel, row: number[]): Attribution[] {
  return model.featureNames.map((name, j) => ({
    name,
    value: row[j],
    contribution: (model.weights[j] * (row[j] - model.xMean[j])) / model.xStd[j],
  }));
}

export function r2Score(yTrue: number[], yPred: number[]): number {
  const ym = yTrue.reduce((a, b) => a + b, 0) / yTrue.length;
  const ssRes = yTrue.reduce((a, y, i) => a + (y - yPred[i]) ** 2, 0);
  const ssTot = yTrue.reduce((a, y) => a + (y - ym) ** 2, 0);
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

export function maeScore(yTrue: number[], yPred: number[]): number {
  return yTrue.reduce((a, y, i) => a + Math.abs(y - yPred[i]), 0) / yTrue.length;
}

export function mapeScore(yTrue: number[], yPred: number[]): number {
  return (
    ((yTrue.reduce((a, y, i) => a + Math.abs((y - yPred[i]) / Math.max(y, 1e-9)), 0) /
      yTrue.length) *
      100)
  );
}

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

// ============================================================
// Quantile ridge regression (pinball loss, gradient descent).
//
// Trains a linear model for a specific quantile τ (e.g. 0.1/0.5/0.9)
// by minimizing the pinball loss
//   ρ_τ(u) = u·τ        if u ≥ 0   (u = y − ŷ, under-prediction)
//          = u·(τ − 1)  if u < 0   (over-prediction)
// plus an L2 penalty. This yields honest P10/P50/P90 risk bands —
// the band is WIDER where the data is noisier (e.g. monsoon weeks),
// which is what a government early-warning tool must show.
// Same standardization + held-out split semantics as trainRidge.
// ============================================================

export interface QuantileModel {
  tau: number;
  weights: number[];
  offset: number; // empirical τ-quantile of centered train targets
  xMean: number[];
  xStd: number[];
  featureNames: string[];
  metrics: {
    pinball: number; // held-out pinball loss (lower is better)
    trainSamples: number;
    testSamples: number;
  };
}

export interface QuantileBand {
  p10: number;
  p50: number;
  p90: number;
}

/** Empirical quantile (linear interpolation) of a numeric array. */
export function quantileOf(sortedValues: number[], tau: number): number {
  if (sortedValues.length === 0) return 0;
  const pos = (sortedValues.length - 1) * tau;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (pos - lo);
}

/**
 * Train one quantile ridge model. X/y raw; testIdx held out for
 * honest pinball loss (scaler + offset fitted on TRAIN rows only).
 */
export function trainQuantileRidge(
  X: number[][],
  y: number[],
  tau: number,
  opts: TrainOptions,
  testIdx: number[] = [],
): QuantileModel {
  const { featureNames } = opts;
  const l2 = opts.l2 ?? 1.0;
  const lr = opts.lr ?? 0.08;
  const epochs = opts.epochs ?? 3000;
  const d = X[0].length;

  const testSet = new Set(testIdx);
  const trainIdx = X.map((_, i) => i).filter((i) => !testSet.has(i));
  const Xtr = trainIdx.map((i) => X[i]);
  const ytr = trainIdx.map((i) => y[i]);
  const n = Xtr.length;

  const { mean, std } = fitScaler(Xtr);
  const Xs = standardize(Xtr, mean, std);
  // Offset = trained intercept, initialized at the empirical τ-quantile of
  // the train targets. It MUST be trained jointly with the weights: when the
  // target has slope in x, the optimal conditional-quantile intercept is NOT
  // the marginal τ-quantile of y (that only holds for the mean/MSE case).
  const ySorted = [...ytr].sort((a, b) => a - b);
  let offset = quantileOf(ySorted, tau);

  const w = new Array(d).fill(0);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Array(d).fill(0);
    let gradOff = 0;
    for (let i = 0; i < n; i++) {
      let pred = 0;
      for (let j = 0; j < d; j++) pred += w[j] * Xs[i][j];
      const u = ytr[i] - (offset + pred); // residual, positive = under-prediction
      // dρ_τ/du = τ (u>0) | τ−1 (u<0); chain rule through ŷ = offset + Σw·xs
      const drdu = u > 0 ? tau : u < 0 ? tau - 1 : tau - 0.5;
      gradOff -= drdu / n; // dL/d(offset) = −dρ/du
      for (let j = 0; j < d; j++) grad[j] += (-drdu * Xs[i][j]) / n;
    }
    // L2 applies to weights only, never the intercept
    for (let j = 0; j < d; j++) w[j] -= lr * (grad[j] + (l2 * w[j]) / n);
    offset -= lr * gradOff;
  }

  const predictRaw = (row: number[]) => {
    let p = offset;
    for (let j = 0; j < d; j++) p += (w[j] * (row[j] - mean[j])) / std[j];
    return p;
  };

  const evalIdx = testIdx.length > 0 ? testIdx : X.map((_, i) => i);
  const pev = evalIdx.map((i) => predictRaw(X[i]));
  const yev = evalIdx.map((i) => y[i]);
  const pinball =
    yev.reduce((a, yv, i) => {
      const u = yv - pev[i];
      return a + (u >= 0 ? tau * u : (tau - 1) * u);
    }, 0) / Math.max(yev.length, 1);

  return {
    tau,
    weights: w,
    offset,
    xMean: mean,
    xStd: std,
    featureNames,
    metrics: { pinball, trainSamples: n, testSamples: testIdx.length },
  };
}

export function predictQuantile(model: QuantileModel, row: number[]): number {
  let p = model.offset;
  for (let j = 0; j < model.weights.length; j++) {
    p += (model.weights[j] * (row[j] - model.xMean[j])) / model.xStd[j];
  }
  return p;
}

/**
 * Quantile-crossing guard: quantile regressions trained independently
 * can produce crossing bands on individual rows; re-sorting the three
 * values per row is the standard monotonicity fix.
 */
export function sortBand(p10: number, p50: number, p90: number): QuantileBand {
  const v = [p10, p50, p90].sort((a, b) => a - b);
  return { p10: v[0], p50: v[1], p90: v[2] };
}

/** Empirical coverage of held-out actuals inside [P10,P90] — target ≈ 80%. */
export function bandCoverage(yTrue: number[], p10: number[], p90: number[]): number {
  if (yTrue.length === 0) return 0;
  const inside = yTrue.reduce(
    (a, yv, i) => a + (yv >= p10[i] && yv <= p90[i] ? 1 : 0),
    0,
  );
  return inside / yTrue.length;
}
