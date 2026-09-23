// ============================================================
// Production hardening v1.2 — Role-based access control.
// Dependency-free: scrypt password hashing + HMAC-signed cookie
// sessions (node:crypto). Documented scope: demo/government-pilot
// grade; production path is SSO/OIDC via NIC (see DEPLOY_GUIDE.md).
//
// Roles:
//   admin   — everything (ingest, feedback, user mgmt)
//   officer — ingest + field feedback (mine geologist/official)
//   viewer  — read-only dashboards (default)
// ============================================================

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "admin" | "officer" | "viewer";

export const ROLE_RANK: Record<Role, number> = { viewer: 0, officer: 1, admin: 2 };

export interface SessionPayload {
  sub: string; // user email
  name: string;
  role: Role;
  iat: number; // issued at (epoch sec)
  exp: number; // expiry (epoch sec)
}

const SESSION_TTL_SEC = 12 * 3600; // 12-hour sessions

function secret(): string {
  // Deterministic dev fallback so tests/sessions survive restarts in the
  // sandbox; real deployments MUST set SESSION_SECRET (see DEPLOY_GUIDE.md).
  return process.env.SESSION_SECRET ?? "moil-intelligence-dev-secret-change-me";
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- signed cookie sessions ----------

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

/** Create a signed session token (payload.sig, both base64url). */
export function createSessionToken(sub: string, name: string, role: Role, now = Date.now()): string {
  const payload: SessionPayload = {
    sub,
    name,
    role,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + SESSION_TTL_SEC,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify signature + expiry; returns null on any failure. */
export function verifySessionToken(token: string | undefined | null, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    if (!["admin", "officer", "viewer"].includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extract + verify session from a Request's Cookie header. */
export function sessionFromRequest(req: Request): SessionPayload | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)moil_session=([^;]+)/);
  return verifySessionToken(match?.[1]);
}

/** Guard: return the session if role rank ≥ minRole, else a 401/403 Response. */
export function requireRole(
  req: Request,
  minRole: Role,
): { ok: true; session: SessionPayload } | { ok: false; response: Response } {
  const session = sessionFromRequest(req);
  if (!session) {
    return { ok: false, response: Response.json({ error: "authentication required" }, { status: 401 }) };
  }
  if (ROLE_RANK[session.role] < ROLE_RANK[minRole]) {
    return {
      ok: false,
      response: Response.json({ error: `role '${session.role}' may not perform this action` }, { status: 403 }),
    };
  }
  return { ok: true, session };
}

export const SESSION_COOKIE = "moil_session";
export const SESSION_MAX_AGE = SESSION_TTL_SEC;
