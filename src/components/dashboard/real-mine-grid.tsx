"use client";

// ============================================================
// REAL satellite-derived lease grid for ANY selected mine.
// Data: /api/prospectivity?mineCode=X → research/multi-mine
// pipeline artifacts (USGS MRDS + GSI + Copernicus DEM + S2).
// Every element carries provenance labels.
// ============================================================

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/components/dashboard/use-api";
import { ErrorCard } from "@/components/dashboard/error-card";
import { Crosshair, Database, Satellite } from "lucide-react";

interface RealCell {
  row: number;
  col: number;
  lat: number;
  lng: number;
  probability: number;
  tier: string;
  elev_m: number;
  ndvi: number;
  sausar: number;
  sakoli: number;
  gneiss: number;
  dist_mn_km: number;
}
interface RealTarget {
  lat: number;
  lng: number;
  prospectivity: number;
  tier: string;
  nearest_known_site: string;
  nearest_dev_status: string;
  dist_to_nearest_km: number;
}
interface RealMineData {
  provenance: { data: string; scores: string; metrics: string };
  mine: {
    code: string;
    name: string;
    cellsTotal: number;
    high: number;
    medium: number;
    low: number;
    estMt: number;
    avgProspectivity: number;
    mnSitesWithin15km: number;
    nearSites: { site: string; dev: string }[];
    topTargets: RealTarget[];
    cells: RealCell[];
  };
  model: {
    ensemble: { ensemble: string; tier_thresholds: { high_min: number; medium_min: number } };
    honestCv: { logistic: number; random_forest: number; lightgbm: number; lightgbm_pu: number };
  };
  labelRule: { caveat: string };
  runUtc: string;
}

function heatColor(p: number): string {
  if (p < 0.2) return "var(--cell-p0)";
  if (p < 0.35) return "var(--hm-1)";
  if (p < 0.5) return "var(--hm-2)";
  if (p < 0.65) return "var(--hm-3)";
  if (p < 0.8) return "var(--hm-4)";
  return "var(--hm-5)";
}

export function RealMineGrid({ mineCode }: { mineCode: string }) {
  const { data, loading, error } = useApi<RealMineData>(
    `/api/prospectivity?mineCode=${mineCode}`,
  );

  // Percentile-rank each cell's probability within this mine so the
  // heatmap shows RELATIVE prospectivity (scores are region-ranked).
  const ranked = useMemo(() => {
    if (!data?.mine?.cells) return new Map<string, number>();
    const probs = data.mine.cells.map((c) => c.probability);
    const sorted = [...probs].sort((a, b) => a - b);
    const m = new Map<string, number>();
    for (const c of data.mine.cells) {
      const rank = sorted.filter((v) => v <= c.probability).length / sorted.length;
      m.set(`${c.row}-${c.col}`, rank);
    }
    return m;
  }, [data]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <ErrorCard
        title="Real satellite grid unavailable"
        message={error ?? "Unknown error"}
      />
    );
  }

  const m = data.mine;
  const gridRows = Math.max(...m.cells.map((c) => c.row)) + 1;
  const gridCols = Math.max(...m.cells.map((c) => c.col)) + 1;

  return (
    <div className="space-y-4">
      <Card className="border-green-600/30">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400">
              <Satellite className="mr-1 h-3 w-3" aria-hidden="true" />
              REAL SATELLITE DATA
            </Badge>
            <CardTitle className="text-base">
              {m.name} — real prospectivity grid
            </CardTitle>
          </div>
          <CardDescription>
            {m.cellsTotal} cells × ~1.1 km, scored by an ensemble (logistic + random
            forest) on real public data — USGS MRDS occurrences, GSI 1:2M geology,
            Copernicus DEM GLO-30, Sentinel-2 L2A. Labels = proximity to{" "}
            {m.mnSitesWithin15km} documented Mn sites within 15 km. Scores rank
            exploration priority — not certified reserves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Est. potential (real model)", value: `${m.estMt.toFixed(1)} Mt` },
              { label: "High-tier cells", value: `${m.high} / ${m.cellsTotal}` },
              { label: "Mean prospectivity", value: `${(m.avgProspectivity * 100).toFixed(0)}%` },
              { label: "Grid", value: `${gridRows} × ${gridCols} · ~1.1 km` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-muted/40 p-2.5 text-center">
                <p className="text-lg font-semibold tabular-nums">{s.value}</p>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Lease grid — real prospectivity (percentile within lease)
              </p>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                low
                <span
                  className="inline-block h-2 w-24 rounded-full"
                  style={{
                    background:
                      "linear-gradient(to right, var(--cell-p0), var(--hm-1), var(--hm-2), var(--hm-3), var(--hm-4), var(--hm-5))",
                  }}
                />
                high
              </span>
            </div>
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
            >
              {m.cells.map((c) => (
                <div
                  key={`${c.row}-${c.col}`}
                  title={`Cell (${c.row},${c.col}) · prospectivity ${(c.probability * 100).toFixed(0)}% · tier ${c.tier}\nElev ${c.elev_m} m · NDVI ${c.ndvi.toFixed(2)} · Sausar ${(c.sausar * 100).toFixed(0)}% / Sakoli ${(c.sakoli * 100).toFixed(0)}% / Gneiss ${(c.gneiss * 100).toFixed(0)}%\nNearest known Mn site ${c.dist_mn_km.toFixed(1)} km`}
                  className="aspect-square rounded-[3px] transition-colors hover:ring-1 hover:ring-foreground/60"
                  style={{ backgroundColor: heatColor(ranked.get(`${c.row}-${c.col}`) ?? 0) }}
                />
              ))}
            </div>
          </div>

          <p className="mt-3 flex items-start gap-1.5 rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {data.labelRule.caveat} · Honest validation: discovery-blind spatial
              block CV (LightGBM AUC {data.model.honestCv.lightgbm.toFixed(3)}, PU-bagged{" "}
              {data.model.honestCv.lightgbm_pu.toFixed(3)}, RF{" "}
              {data.model.honestCv.random_forest.toFixed(3)}) — no proximity
              feature. Pipeline run {new Date(data.runUtc).toLocaleDateString()}.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Top drill targets with named nearest occurrences */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crosshair className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Priority drill targets — real model, {m.name}
          </CardTitle>
          <CardDescription>
            Each target is annotated with the nearest USGS-documented Mn occurrence
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {m.topTargets.map((t, i) => (
              <div
                key={`${t.lat}-${t.lng}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-700 dark:text-amber-400">
                    {i + 1}
                  </span>
                  {t.lat.toFixed(3)}°N, {t.lng.toFixed(3)}°E
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={
                      t.tier === "high"
                        ? "border-red-500/40 text-red-600 dark:text-red-400"
                        : "border-amber-500/40 text-amber-700 dark:text-amber-400"
                    }
                  >
                    {t.tier}
                  </Badge>
                  nearest: <span className="font-medium text-foreground">{t.nearest_known_site}</span> (
                  {t.nearest_dev_status}, {t.dist_to_nearest_km.toFixed(1)} km)
                  <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                    {(t.prospectivity * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
