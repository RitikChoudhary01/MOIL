import { describe, expect, test } from "bun:test";
import {
  MOIL_VERIFIED_PRODUCTION,
  MOIL_VERIFIED_CONTEXT,
  VERIFIED_FY26_TONNES,
  FY26_START_ISO,
  FY26_END_EXCL_ISO,
} from "../src/lib/public-data";

/**
 * Integrity checks for the VERIFIED public production record.
 * Government-facing rule: every figure must carry a named source,
 * a publication date, and a plausible magnitude. Nothing simulated
 * may enter this dataset.
 */
describe("MOIL verified public record", () => {
  test("dataset is non-empty and every figure has a source + date", () => {
    expect(MOIL_VERIFIED_PRODUCTION.length).toBeGreaterThanOrEqual(10);
    for (const f of MOIL_VERIFIED_PRODUCTION) {
      expect(f.source.length).toBeGreaterThan(3);
      expect(f.source).not.toMatch(/simulat|synthetic|estimate/i);
      expect(() => new Date(f.publishedOn).toISOString()).not.toThrow();
      expect(Number.isFinite(f.tonnes)).toBe(true);
    }
  });

  test("annual figures are in the verified range and increasing (FY24 < FY25 < FY26)", () => {
    const annual = MOIL_VERIFIED_PRODUCTION.filter((f) => f.periodType === "annual");
    const byperiod = Object.fromEntries(annual.map((f) => [f.period, f.tonnes]));
    expect(byperiod["FY2023-24"]).toBe(1_756_000);
    expect(byperiod["FY2024-25"]).toBe(1_802_000);
    expect(byperiod["FY2025-26"]).toBe(1_907_000);
    expect(byperiod["FY2023-24"]).toBeLessThan(byperiod["FY2024-25"]);
    expect(byperiod["FY2024-25"]).toBeLessThan(byperiod["FY2025-26"]);
  });

  test("no monthly figure contradicts its fiscal-year annual total", () => {
    const fy26 = MOIL_VERIFIED_PRODUCTION.find((f) => f.period === "FY2025-26")!;
    const monthly = MOIL_VERIFIED_PRODUCTION.filter(
      (f) => f.periodType === "month" && f.period.startsWith("2025-"),
    );
    for (const m of monthly) {
      expect(m.tonnes).toBeLessThan(fy26.tonnes / 6); // no single month > 1/6 of the year
    }
  });

  test("FY26 anchor matches the PIB/company reported 19.07 lakh tonnes", () => {
    expect(VERIFIED_FY26_TONNES).toBe(1_907_000);
    expect(FY26_START_ISO).toBe("2025-04-01");
    expect(FY26_END_EXCL_ISO).toBe("2026-04-01");
  });

  test("context facts carry sources and no unverifiable claims", () => {
    expect(MOIL_VERIFIED_CONTEXT.length).toBeGreaterThanOrEqual(2);
    for (const c of MOIL_VERIFIED_CONTEXT) {
      expect(c.source.length).toBeGreaterThan(3);
    }
  });
});
