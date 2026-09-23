// ============================================================
// Module A — Reserve Mapping Model
// Logistic regression trained via gradient descent on
// satellite + geological proxy features per grid cell.
// Outputs P(ore presence) for every cell of a mine lease.
// Features are domain-informed (PRD §10):
//   - NDVI anomaly (vegetation stress over manganiferous zones)
//   - Lithology favorability (Sausar/Sakoli/Amgaon metasediments)
//   - Distance to known ore horizon (GSI public maps)
//   - Land surface temperature, soil moisture
// ============================================================

import { sigmoid } from "./regression";

export interface LogisticModel {
  weights: number[];
  bias: number;
  xMean: number[];
  xStd: number[];
  featureNames: string[];
  auc: number;
  trainCells: number;
  accuracy: number;
}

export const RESERVE_FEATURES = [
  "Lithology favorability",
  "Distance to ore horizon",
  "NDVI anomaly",
  "Soil moisture",
  "Land surface temp",
];

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

export function trainLogistic(
  X: number[][],
  y: number[],
  opts: { lr?: number; epochs?: number; l2?: number } = {},
): LogisticModel {
  const lr = opts.lr ?? 0.1;
  const epochs = opts.epochs ?? 6000;
  const l2 = opts.l2 ?? 0.01;
  const n = X.length;
  const d = X[0].length;

  const { mean, std } = fitScaler(X);
  const Xs = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));

  const w = new Array(d).fill(0);
  let b = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Xs[i][j];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += (err * Xs[i][j]) / n;
      gb += err / n;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] + l2 * w[j]);
    b -= lr * gb;
  }

  const probs = Xs.map((row) => {
    let z = b;
    for (let j = 0; j < d; j++) z += w[j] * row[j];
    return sigmoid(z);
  });

  const auc = aucScore(y, probs);
  const accuracy =
    y.filter((yi, i) => (probs[i] >= 0.5 ? 1 : 0) === yi).length / n;

  return {
    weights: w,
    bias: b,
    xMean: mean,
    xStd: std,
    featureNames: RESERVE_FEATURES,
    auc,
    trainCells: n,
    accuracy,
  };
}

export function predictLogistic(model: LogisticModel, row: number[]): number {
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    z += (model.weights[j] * (row[j] - model.xMean[j])) / model.xStd[j];
  }
  return sigmoid(z);
}

/** ROC-AUC via pairwise concordance (efficient enough at our scale). */
export function aucScore(yTrue: number[], probs: number[]): number {
  const pos = probs.filter((_, i) => yTrue[i] === 1);
  const neg = probs.filter((_, i) => yTrue[i] === 0);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
