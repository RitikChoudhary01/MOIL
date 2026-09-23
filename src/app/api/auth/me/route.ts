// GET /api/auth/me — current session identity (null-safe).
import { sessionFromRequest } from "@/lib/auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  return Response.json(
    {
      authenticated: !!session,
      user: session ? { email: session.sub, name: session.name, role: session.role } : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
