// POST /api/auth/login — issue an HMAC-signed session cookie.
// scrypt password verification, per-IP rate limiting, audit-logged.
import { db } from "@/lib/db";
import { parseWith } from "@/lib/validate";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createSessionToken, verifyPassword, SESSION_COOKIE, SESSION_MAX_AGE, type Role } from "@/lib/auth";

const LoginBody = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // Brute-force guard: 10 attempts / minute / IP
  const rl = rateLimit(`login:${ip}`, 10, 1 / 6);
  if (!rl.ok) {
    return Response.json(
      { error: "too many attempts, slow down" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = parseWith(LoginBody, raw);
  if (!parsed.ok) return parsed.response;
  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await db.auditLog.create({
    data: { actor: user.email, action: "login", detail: JSON.stringify({ role: user.role }) },
  });

  const token = createSessionToken(user.email, user.name, user.role as Role);
  return new Response(JSON.stringify({
    ok: true,
    user: { email: user.email, name: user.name, role: user.role },
  }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
    },
  });
}
