// ============================================================
// Production hardening v1.2 — RBAC, drift monitor, ingest contract.
// All tests run on deterministic synthetic data — provable properties,
// no network, no DB. Mocks for @/lib/db avoid Prisma engine startup.
// ============================================================
import { describe, test, expect, vi } from "bun:test";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: async () => null, update: async () => null },
    auditLog: { create: async (d: unknown) => ({ id: "mock", ...(d as object) }) },
  },
}));

import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  requireRole,
  sessionFromRequest,
} from "@/lib/auth";
import { buildDriftReport, psi, verdictOf } from "@/lib/ml/drift";
import { IngestRow, IngestBody } from "@/lib/validate";

// ---------- RBAC: passwords ----------

describe("RBAC password hashing (scrypt)", () => {
  test("roundtrip: correct password verifies", () => {
    const hash = hashPassword("moil-admin-2026");
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/); // salt:hash hex
    expect(verifyPassword("moil-admin-2026", hash)).toBe(true);
  });

  test("wrong password rejected; unique salt per hash", () => {
    const h1 = hashPassword("same-password");
    const h2 = hashPassword("same-password");
    expect(verifyPassword("wrong-password", h1)).toBe(false);
    expect(h1).not.toBe(h2); // per-call salt
  });
});

// ---------- RBAC: signed sessions ----------

describe("HMAC-signed session tokens", () => {
  const NOW = 1_760_000_000_000; // fixed epoch ms

  test("roundtrip: token verifies with correct claims", () => {
    const tok = createSessionToken("admin@moil.gov.in", "Admin", "admin", NOW);
    const s = verifySessionToken(tok, NOW + 1000);
    expect(s?.sub).toBe("admin@moil.gov.in");
    expect(s?.role).toBe("admin");
    expect(s!.exp - s!.iat).toBe(12 * 3600);
  });

  test("tampered payload rejected (signature mismatch)", () => {
    const tok = createSessionToken("officer@moil.gov.in", "Officer", "officer", NOW);
    const [payload] = tok.split(".");
    // privilege escalation attempt: officer → admin in a forged payload
    const forged = Buffer.from(
      JSON.stringify({ sub: "officer@moil.gov.in", name: "Officer", role: "admin", iat: 1, exp: 2 }),
    ).toString("base64url");
    expect(verifySessionToken(`${forged}.${tok.split(".")[1]}`, NOW)).toBeNull();
    expect(payload).toBeTruthy();
  });

  test("expired token rejected", () => {
    const tok = createSessionToken("v@moil.gov.in", "V", "viewer", NOW);
    expect(verifySessionToken(tok, NOW + 12 * 3600 * 1000 + 60_000)).toBeNull();
  });

  test("requireRole gates: 401 unauthenticated, 403 insufficient role", () => {
    const viewerTok = createSessionToken("v@moil.gov.in", "V", "viewer");
    const officerTok = createSessionToken("o@moil.gov.in", "O", "officer");
    const req = (tok?: string) => new Request("http://x/api/ingest/production", { headers: tok ? { cookie: `moil_session=${tok}` } : {} });

    expect(requireRole(req(), "viewer").ok).toBe(false); // 401 branch
    const viewerRes = requireRole(req(viewerTok), "officer");
    expect(viewerRes.ok).toBe(false);
    if (!viewerRes.ok) expect(viewerRes.response.status).toBe(403);
    const officerRes = requireRole(req(officerTok), "officer");
    expect(officerRes.ok).toBe(true);
    if (officerRes.ok) expect(officerRes.session.sub).toBe("o@moil.gov.in");
  });

  test("sessionFromRequest reads the moil_session cookie", () => {
    const tok = createSessionToken("a@moil.gov.in", "A", "admin");
    const req = new Request("http://x/", { headers: { cookie: `other=1; moil_session=${tok}` } });
    expect(sessionFromRequest(req)?.role).toBe("admin");
    expect(sessionFromRequest(new Request("http://x/"))).toBeNull();
  });
});

// ---------- Drift monitor (PSI) ----------

describe("PSI drift monitor", () => {
  test("identical distributions → PSI ≈ 0, verdict stable", () => {
    const rng = (seed: number) => () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const r = rng(42);
    const xs = Array.from({ length: 4000 }, () => r() * 100);
    const p = psi(xs, xs.slice(0, 2000));
    expect(p).toBeLessThan(0.02);
    expect(verdictOf(p)).toBe("stable");
  });

  test("large shift → PSI > 0.25, verdict significant", () => {
    const base = Array.from({ length: 4000 }, (_, i) => i % 100); // uniform 0..99
    const shifted = Array.from({ length: 1000 }, () => 90 + (iLen(1000) % 10)); // pile into top bins
    function iLen(n: number) { return base.length % n; } // deterministic filler
    const p = psi(base, shifted);
    expect(p).toBeGreaterThan(0.25);
    expect(verdictOf(p)).toBe("significant");
  });

  test("buildDriftReport: verdict + retrain flag + per-feature table", () => {
    const stable = Array.from({ length: 3000 }, (_, i) => 50 + (i % 20));
    // baseline uniform 0–4 vs recent pinned at 4 → top-bin pile-up ⇒ big PSI
    const driftBase = Array.from({ length: 3000 }, (_, i) => i % 5);
    const driftRecent = Array.from({ length: 300 }, () => 4);
    const report = buildDriftReport(
      { rainfall: stable, downtimeHours: stable, blastingDelays: driftBase },
      { rainfall: stable.slice(0, 300), downtimeHours: stable.slice(0, 300), blastingDelays: driftRecent },
      { from: new Date("2025-01-01"), to: new Date("2026-06-01") },
      { from: new Date("2026-06-01"), to: new Date("2026-09-01") },
    );
    expect(report.features).toHaveLength(3);
    expect(report.worst?.feature).toBe("blastingDelays");
    expect(report.verdict).toBe("significant");
    expect(report.retrainRecommended).toBe(true);
    expect(report.baselineWindow.n).toBe(3000);
  });
});

// ---------- Ingest contract ----------

describe("ERP ingest row schema", () => {
  const valid = {
    mineCode: "BLGT",
    weekStart: "2026-09-07",
    actual: 7890,
    downtimeHours: 6.5,
    equipmentUtilization: 0.87,
  };

  test("accepts a canonical row; optional fields stay optional", () => {
    const r = IngestRow.safeParse(valid);
    expect(r.success).toBe(true);
  });

  test("rejects bad mine code / non-ISO week / negative tonnage / util > 1", () => {
    expect(IngestRow.safeParse({ ...valid, mineCode: "blg" }).success).toBe(false);
    expect(IngestRow.safeParse({ ...valid, weekStart: "07-09-2026" }).success).toBe(false);
    expect(IngestRow.safeParse({ ...valid, actual: -5 }).success).toBe(false);
    expect(IngestRow.safeParse({ ...valid, equipmentUtilization: 1.2 }).success).toBe(false);
  });

  test("batch caps at 2000 rows (DoS bound)", () => {
    const rows = Array.from({ length: 2001 }, () => valid);
    expect(IngestBody.safeParse({ rows }).success).toBe(false);
  });
});
