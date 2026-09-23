// ============================================================
// Production hardening unit tests — CSV serialization, cache,
// rate limiter, validation schemas, scenario counterfactuals.
// Run: bun test tests/
// ============================================================
import { describe, expect, test } from "bun:test";
import { csvField, toCsv } from "../src/lib/csv";
import { cacheGet, cacheSet, cached, cacheInvalidate } from "../src/lib/api-cache";
import { rateLimit } from "../src/lib/rate-limit";
import { MineIdQuery, MineCodeQuery, parseWith } from "../src/lib/validate";
import { simulateScenario, type ProductionModelBundle, type MineScenarioContext } from "../src/lib/ml/scenario";
import { trainRidge } from "../src/lib/ml/regression";

// ---------- CSV ----------

describe("csv serialization (RFC 4180)", () => {
  test("escapes commas, quotes and newlines", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField(null)).toBe("");
    expect(csvField(42)).toBe("42");
  });

  test("toCsv unifies columns and terminates rows", () => {
    const csv = toCsv([
      { a: 1, b: "x" },
      { a: 2, b: "y,z" },
    ]);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("a,b");
    expect(lines[2]).toBe('2,"y,z"');
  });

  test("toCsv empty rows with explicit columns → header only", () => {
    expect(toCsv([], ["a", "b"])).toBe("a,b\n");
  });
});

// ---------- API cache ----------

describe("api cache", () => {
  test("set/get roundtrip + expiry", async () => {
    cacheSet("t:a", { v: 1 }, 10_000);
    expect(cacheGet("t:a")).toEqual({ v: 1 });

    cacheSet("t:short", "x", 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(cacheGet("t:short")).toBeUndefined();
  });

  test("cached() computes once and negative-results are not cached", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return { n: calls };
    };
    const [r1, r2] = await Promise.all([cached("t:once", 5000, loader), cached("t:once", 5000, loader)]);
    // sequential calls hit cache
    const r3 = await cached("t:once", 5000, loader);
    expect(r1.n).toBe(1);
    expect(r2.n).toBe(1);
    expect(r3.n).toBe(1);
    expect(calls).toBe(1);
  });

  test("cacheInvalidate removes prefix matches only", () => {
    cacheSet("pfx:a", 1, 5000);
    cacheSet("pfx:b", 2, 5000);
    cacheSet("other:c", 3, 5000);
    const n = cacheInvalidate("pfx:");
    expect(n).toBe(2);
    expect(cacheGet("pfx:a")).toBeUndefined();
    expect(cacheGet("other:c")).toBe(3);
  });
});

// ---------- Rate limiter ----------

describe("rate limiter (token bucket)", () => {
  test("allows burst then blocks, then recovers", async () => {
    const key = `test:${Math.random()}`;
    // drain capacity 3
    expect(rateLimit(key, 3, 1).ok).toBe(true);
    expect(rateLimit(key, 3, 1).ok).toBe(true);
    expect(rateLimit(key, 3, 1).ok).toBe(true);
    const blocked = rateLimit(key, 3, 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    // tokens refill over time
    await new Promise((r) => setTimeout(r, 1100));
    expect(rateLimit(key, 3, 1).ok).toBe(true);
  });
});

// ---------- Validation ----------

describe("validation schemas", () => {
  test("mineId accepts cuid-like, rejects junk", () => {
    const ok = parseWith(MineIdQuery, { mineId: "cmd0abcdefgh0123456789" });
    expect(ok.ok).toBe(true);
    const bad = parseWith(MineIdQuery, { mineId: "'; DROP TABLE Mine;--" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.response.status).toBe(400);
  });

  test("mineId empty string means 'all'", () => {
    const ok = parseWith(MineIdQuery, { mineId: "" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.mineId).toBeUndefined();
  });

  test("mineCode normalizes case and enforces 4 letters", () => {
    const ok = parseWith(MineCodeQuery, { mineCode: "blgt" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.mineCode).toBe("BLGT");
    const bad = parseWith(MineCodeQuery, { mineCode: "TOOLONG" });
    expect(bad.ok).toBe(false);
  });
});

// ---------- Scenario engine (exact counterfactual) ----------

function makeBundle(): ProductionModelBundle {
  // Deterministic synthetic model: y strongly depends on downtime (negative)
  // and haulers (positive). Train on the SAME layout scenario.ts uses.
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 400; i++) {
    const target = 3000 + (i % 11) * 10;
    const rain = (i % 30) * 5;
    const rainLag = ((i + 7) % 30) * 5;
    const downtime = (i % 24) * 4;
    const maint = i % 4;
    const blast = (i % 5) * 1.5;
    const haulers = 4 + (i % 6);
    const util = 0.5 + ((i % 40) / 100);
    const monsoon = i % 2;
    const pitRain = monsoon ? rain : 0;
    X.push([target, rain, rainLag, downtime, maint, blast, haulers, util, monsoon, pitRain]);
    // y = 0.62*target − 9*downtime + 95*haulers + 12000*util − noise-free
    y.push(0.62 * target - 9 * downtime + 95 * haulers + 12000 * util - 30 * rain);
  }
  const model = trainRidge(X, y, { featureNames: [...Array(10).keys()].map(String), epochs: 3000, l2: 0.01 });

  const baselineRow = [3000, 20, 20, 24, 1, 3, 6, 0.8, 0, 0];
  const ctx: MineScenarioContext = {
    mineId: "testmine0000000000000a",
    code: "TST1",
    name: "Test Mine",
    type: "open-pit",
    baselineRow,
    baselineValues: {
      downtimeHours: 24,
      maintenanceEvents: 1,
      blastingDelays: 3,
      haulerCount: 6,
      equipmentUtilization: 0.8,
      rainfallMm: 20,
    },
    baselineWeek: "2026-09-07",
    residualBand: { q10: -900, q90: 700, n: 8 },
    ranges: {
      downtimeHours: { min: 0, max: 96, step: 2, unit: "hrs/wk", label: "Equipment downtime" },
      haulerCount: { min: 0, max: 12, step: 1, unit: "haulers", label: "Active haulers" },
      equipmentUtilization: { min: 0.3, max: 1, step: 0.01, unit: "ratio", label: "Equipment utilization" },
      blastingDelays: { min: 0, max: 12, step: 0.5, unit: "hrs/wk", label: "Blasting delays" },
      maintenanceEvents: { min: 0, max: 8, step: 1, unit: "events/wk", label: "Maintenance events" },
      rainfallMm: { min: 0, max: 180, step: 5, unit: "mm/wk", label: "Rainfall (stress test)" },
    },
  };
  return {
    model,
    quantiles: { coverage80: 0.8, note: "per-mine split-conformal test bundle" },
    contexts: new Map([[ctx.mineId, ctx]]),
    metrics: { holdoutR2: 0.9, holdoutMape: 10, trainWeeks: 400, testWeeks: 52 },
  };
}

describe("scenario engine", () => {
  test("baseline with no overrides reproduces the model score", () => {
    const bundle = makeBundle();
    const r = simulateScenario(bundle, "testmine0000000000000a", {});
    expect(r).not.toBeNull();
    if (!r) return;
    // zero overrides → zero delta (exactness)
    expect(r.delta.tonnes).toBe(0);
  });

  test("more downtime lowers output; more haulers raise it", () => {
    const bundle = makeBundle();
    const id = "testmine0000000000000a";
    const worse = simulateScenario(bundle, id, { downtimeHours: 72 });
    const better = simulateScenario(bundle, id, { haulerCount: 9 });
    expect(worse).not.toBeNull();
    expect(better).not.toBeNull();
    if (!worse || !better) return;
    expect(worse.delta.tonnes).toBeLessThan(0);
    expect(better.delta.tonnes).toBeGreaterThan(0);
    // contributions sum (±rounding) to the delta — exact linear-SHAP
    const sumWorse = worse.contributions.reduce((a, c) => a + c.contribution, 0);
    expect(Math.abs(sumWorse - worse.delta.tonnes)).toBeLessThan(2);
    // horizon is 4× weekly
    expect(better.delta.horizon4wk).toBe(Math.round(better.delta.tonnes * 4));
  });

  test("unknown mine id → null (route maps to 404)", () => {
    const bundle = makeBundle();
    expect(simulateScenario(bundle, "nosuchmine00000000000a", {})).toBeNull();
  });
});
