// ============================================================
// Jury-proofing: core ML unit tests.
// Run: bun test tests/ml-core.test.ts
// ============================================================
import { describe, expect, test } from "bun:test";
import { sigmoid, trainRidge, predictRidge } from "../src/lib/ml/regression";
import { trainLogistic, predictLogistic, aucScore } from "../src/lib/ml/reserve";

describe("sigmoid", () => {
  test("extremes and midpoint", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 10);
    expect(sigmoid(100)).toBeCloseTo(1, 6);
    expect(sigmoid(-100)).toBeCloseTo(0, 6);
  });
});

describe("ridge regression (production model core)", () => {
  test("recovers a linear relationship", () => {
    // y = 3*a + 2*b + 1 with noise-free data
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i % 7) + Math.random() * 0.1;
      const b = (i % 5) * 0.5;
      X.push([a, b]);
      y.push(3 * a + 2 * b + 1);
    }
    const m = trainRidge(X, y, {
      featureNames: ["a", "b"],
      epochs: 6000,
      l2: 0.01,
    });
    const pred = predictRidge(m, [4, 2]);
    expect(pred).toBeGreaterThan(3 * 4 + 2 * 2 - 1);
    expect(pred).toBeLessThan(3 * 4 + 2 * 2 + 1);
  });
});

describe("logistic reserve model", () => {
  test("separates well-separated clusters (AUC > 0.9)", () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 80; i++) {
      X.push([Math.random() * 0.3, Math.random() * 0.3]); // negative
      y.push(0);
      X.push([0.7 + Math.random() * 0.3, 0.7 + Math.random() * 0.3]); // positive
      y.push(1);
    }
    const m = trainLogistic(X, y, { epochs: 2000 });
    expect(m.auc).toBeGreaterThan(0.9);
    const p = predictLogistic(m, [0.9, 0.9]);
    expect(p).toBeGreaterThan(0.5);
  });

  test("aucScore handles degenerate inputs", () => {
    expect(aucScore([1, 1], [0.5, 0.6])).toBe(0.5); // no negatives
    expect(aucScore([1, 0], [0.9, 0.1])).toBe(1.0);
    expect(aucScore([1, 0], [0.1, 0.9])).toBe(0.0);
  });
});

// ============================================================
// Quantile ridge (P10/P50/P90 risk bands) — Module B upgrade
// ============================================================
// ============================================================
// Quantile ridge (P10/P50/P90 risk bands) — Module B upgrade.
// Synthetic process is homoscedastic (y = 10 + 2x + U[-5,5]) so the
// true conditional quantiles are PARALLEL lines: P10 = 6+2x,
// P90 = 14+2x → band width ≈ 8 everywhere, coverage ≈ 80%.
// Every assertion below tests a provable property of that process.
// ============================================================
import {
  trainQuantileRidge,
  predictQuantile,
  sortBand,
  bandCoverage,
  quantileOf,
} from "../src/lib/ml/regression";

describe("quantileOf", () => {
  test("empirical quantile with interpolation", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantileOf(v, 0.5)).toBe(5.5);
    expect(quantileOf(v, 0)).toBe(1);
    expect(quantileOf(v, 1)).toBe(10);
    expect(quantileOf([3], 0.9)).toBe(3);
  });
});

function synthHomoscedastic() {
  // Deterministic LCG so the test is reproducible (no Math.random).
  let s = 987654321;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648; // [0, 1)
  };
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 500; i++) {
    const x = (i % 50) * 0.4; // x in [0, 19.6]
    X.push([x]);
    y.push(10 + 2 * x + (rand() * 10 - 5));
  }
  return { X, y };
}

describe("quantile ridge", () => {
  const { X, y } = synthHomoscedastic();
  const testIdx = Array.from({ length: 40 }, (_, i) => 460 + i); // held-out weeks
  // Pinball gradients are BOUNDED (|dρ/dŷ| ≤ 1), unlike MSE — so a larger
  // learning rate is safe and convergence is much faster.
  const opts = { featureNames: ["x"], lr: 0.5, epochs: 12000 };
  const q10 = trainQuantileRidge(X, y, 0.1, opts, testIdx);
  const q50 = trainQuantileRidge(X, y, 0.5, opts, testIdx);
  const q90 = trainQuantileRidge(X, y, 0.9, opts, testIdx);

  test("orders P10 <= P50 <= P90 on held-out rows (no crossings)", () => {
    for (const i of testIdx) {
      const a = predictQuantile(q10, X[i]);
      const b = predictQuantile(q50, X[i]);
      const c = predictQuantile(q90, X[i]);
      expect(a).toBeLessThanOrEqual(b + 1e-6);
      expect(b).toBeLessThanOrEqual(c + 1e-6);
    }
  });

  test("band width ≈ true interquantile range (8) on held-out rows", () => {
    const widths = testIdx.map((i) => predictQuantile(q90, X[i]) - predictQuantile(q10, X[i]));
    const meanW = widths.reduce((a, b) => a + b, 0) / widths.length;
    expect(meanW).toBeGreaterThan(5.5);
    expect(meanW).toBeLessThan(10.5);
  });

  test("held-out coverage of the P10-P90 band ≈ 80%", () => {
    const cov = bandCoverage(
      testIdx.map((i) => y[i]),
      testIdx.map((i) => predictQuantile(q10, X[i])),
      testIdx.map((i) => predictQuantile(q90, X[i])),
    );
    expect(cov).toBeGreaterThanOrEqual(0.6);
    expect(cov).toBeLessThanOrEqual(0.95);
  });

  test("matching-tau pinball: each quantile model beats the others at its own tau", () => {
    const pinAt = (m: typeof q10, tau: number) =>
      testIdx.reduce((a, i) => {
        const u = y[i] - predictQuantile(m, X[i]);
        return a + (u >= 0 ? tau * u : (tau - 1) * u);
      }, 0) / testIdx.length;
    // q90 evaluated with tau=0.9 pinball must beat q10 and q50 there
    expect(pinAt(q90, 0.9)).toBeLessThan(pinAt(q10, 0.9));
    expect(pinAt(q90, 0.9)).toBeLessThan(pinAt(q50, 0.9));
    // and q10 evaluated with tau=0.1 pinball must beat q90 there
    expect(pinAt(q10, 0.1)).toBeLessThan(pinAt(q90, 0.1));
  });

  test("sortBand fixes quantile crossings", () => {
    const b = sortBand(90, 10, 50);
    expect(b.p10).toBe(10);
    expect(b.p50).toBe(50);
    expect(b.p90).toBe(90);
  });
});
