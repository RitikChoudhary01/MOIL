import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/api-cache";
import {
  MOIL_VERIFIED_PRODUCTION,
  MOIL_VERIFIED_CONTEXT,
  VERIFIED_FY26_TONNES,
  FY26_START_ISO,
  FY26_END_EXCL_ISO,
} from "@/lib/public-data";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({}).loose();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const cached = cacheGet<Record<string, unknown>>("public-data");
  if (cached) return NextResponse.json(cached);

  try {
    // Live calibration: digital-twin simulated total for FY2025-26 weeks
    const [simRow, capRow] = await Promise.all([
      db.productionRecord.aggregate({
        where: {
          weekStart: {
            gte: new Date(`${FY26_START_ISO}T00:00:00.000Z`),
            lt: new Date(`${FY26_END_EXCL_ISO}T00:00:00.000Z`),
          },
        },
        _sum: { actual: true, plannedTarget: true },
        _count: true,
      }),
      db.mine.aggregate({ _sum: { annualCapacity: true }, _count: true }),
    ]);

    const simulatedFY26 = Math.round(simRow._sum.actual ?? 0);
    const simulatedPlannedFY26 = Math.round(simRow._sum.plannedTarget ?? 0);
    const nameplateCapacity = capRow._sum.annualCapacity ?? 0;

    const payload = {
      scope: "MOIL Limited, company-wide manganese ore production",
      figures: MOIL_VERIFIED_PRODUCTION,
      context: MOIL_VERIFIED_CONTEXT,
      calibration: {
        anchor: "FY2025-26 verified company production (PIB / company statements)",
        verifiedTonnes: VERIFIED_FY26_TONNES,
        simulatedTonnes: simulatedFY26,
        simulatedPlannedTonnes: simulatedPlannedFY26,
        gapPct: Number(
          (((simulatedFY26 - VERIFIED_FY26_TONNES) / VERIFIED_FY26_TONNES) * 100).toFixed(2),
        ),
        plannerOptimismPct: Number(
          (((simulatedPlannedFY26 - simulatedFY26) / simulatedFY26) * 100).toFixed(2),
        ),
        nameplateCapacityTonnes: nameplateCapacity,
        note: "Digital-twin weekly simulator is calibrated so the FY2025-26 portfolio total reproduces the verified public record. Weekly mine-level ops (downtime, blasting, haulage) are a simulated demonstration layer — no such granular dataset is published by MOIL.",
      },
      disclaimer:
        "All figures in `figures` are verified public data with citations. The weekly mine-level simulation elsewhere in this app is a calibrated digital twin, not recorded MOIL operations data.",
      generatedAt: new Date().toISOString(),
    };

    cacheSet("public-data", payload, 300_000); // 5 min TTL
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[public-data] failed:", err);
    return NextResponse.json(
      { error: "Failed to compute verified record" },
      { status: 500 },
    );
  }
}
