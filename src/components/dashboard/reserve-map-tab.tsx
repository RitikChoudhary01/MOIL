"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, MapPin, Crosshair, HelpCircle, Layers, Satellite, FlaskConical } from "lucide-react";
import { MineTypeBadge } from "@/components/dashboard/shared";
import { RealPipelineSection } from "@/components/dashboard/real-pipeline-section";
import { RealMineGrid } from "@/components/dashboard/real-mine-grid";
import { FieldValidationPanel } from "@/components/dashboard/field-validation-panel";
import { useApi } from "@/hooks/use-api";
import type { ReserveMapData, ReserveMineData, DrillTarget } from "@/lib/types";

// Portfolio summary shape from /api/prospectivity (real multi-mine pipeline)
interface ProspectivityMineSummary {
  code: string;
  cellsTotal: number;
  high: number;
  estMt: number;
  mnSitesWithin15km: number;
}
interface ProspectivitySummary {
  honestCv: { logistic: number; random_forest: number; lightgbm: number; lightgbm_pu: number };
  classBalance: { train_cells: number; positives: number };
  mines: ProspectivityMineSummary[];
  runUtc: string;
}

// ---------- Regional map geometry (simplified public-domain outlines) ----------
const MP_POLY: [number, number][] = [
  [24.0, 75.0], [25.2, 75.3], [26.2, 76.4], [26.6, 77.5], [26.5, 78.6],
  [26.9, 80.2], [25.7, 80.5], [24.9, 81.0], [24.6, 82.8], [23.7, 83.6],
  [23.0, 83.0], [22.8, 82.2], [22.3, 81.3], [21.4, 81.0], [20.8, 80.3],
  [20.9, 78.6], [21.6, 78.1], [21.9, 76.9], [22.4, 75.6], [23.3, 74.9],
];
const MH_POLY: [number, number][] = [
  [21.6, 78.1], [21.5, 79.1], [21.4, 79.9], [20.8, 80.4], [19.9, 80.0],
  [19.2, 79.3], [18.7, 79.8], [17.9, 80.5], [16.9, 80.5], [16.1, 80.1],
  [15.9, 78.4], [15.7, 74.6], [16.9, 73.7], [18.4, 73.4], [19.2, 72.9],
  [19.9, 72.7], [20.6, 72.6], [20.9, 72.9], [21.1, 73.6], [21.2, 74.6],
  [21.3, 75.5], [21.5, 76.3],
];

const project = (lng: number, lat: number): { x: number; y: number } => ({
  x: (lng - 72) * Math.cos((21 * Math.PI) / 180) * 40,
  y: (27 - lat) * 40,
});
const toPath = (poly: [number, number][]): string =>
  poly
    .map(([lat, lng], i) => {
      const { x, y } = project(lng, lat);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ") + " Z";

/** Heat color for ore-presence probability (0..1) — MOIL Terra copper ramp. */
function heatColor(p: number): string {
  if (p < 0.2) return "var(--cell-p0)";
  if (p < 0.35) return "var(--hm-1)";
  if (p < 0.5) return "var(--hm-2)";
  if (p < 0.65) return "var(--hm-3)";
  if (p < 0.8) return "var(--hm-4)";
  return "var(--hm-5)";
}
function pinColor(p: number): string {
  if (p < 0.35) return "var(--chart-plan)";
  if (p < 0.55) return "var(--chart-copper)";
  return "var(--chart-copper-deep)";
}

export function ReserveMapTab({ data }: { data: ReserveMapData }) {
  const [selectedId, setSelectedId] = useState<string>(data.mines[0]?.id ?? "");
  const [selectedTarget, setSelectedTarget] = useState<DrillTarget | null>(null);
  const [gridMode, setGridMode] = useState<"real" | "demo">("real");

  // Real multi-mine pipeline portfolio (all 10 mines, satellite-derived)
  const { data: portfolio } = useApi<ProspectivitySummary>("/api/prospectivity");
  const realByCode = new Map((portfolio?.mines ?? []).map((m) => [m.code, m]));

  const selected: ReserveMineData | undefined =
    data.mines.find((m) => m.id === selectedId) ?? data.mines[0];
  const selectedReal = selected ? realByCode.get(selected.code) : undefined;
  const showReal = gridMode === "real" && !!selectedReal;

  // Full cell record for the selected drill target (same row/col)
  const targetCell = selected && selectedTarget
    ? selected.cells.find((c) => c.row === selectedTarget.row && c.col === selectedTarget.col)
    : undefined;

  // Model weights for the evidence panel (name → signed weight)
  const weightOf = (name: string) =>
    data.modelInfo?.features.find((f) => f.name === name)?.weight;
  const lithoW = weightOf("Lithology favorability");
  const distW = weightOf("Distance to ore horizon");
  const ndviW = weightOf("NDVI anomaly");

  const totalEstMt = data.mines.reduce((a, m) => a + m.stats.estMt, 0);
  const realTotalMt = (portfolio?.mines ?? []).reduce((a, m) => a + m.estMt, 0);

  return (
    <div className="space-y-4">
      {/* ---------- Data provenance banner ---------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3">
        <Badge className="border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400">
          REAL GEO-DATA · ALL 10 MINES
        </Badge>
        <span className="text-xs text-muted-foreground">
          USGS MRDS occurrences, GSI geology, Copernicus DEM, Sentinel-2 — one regional pipeline, per-lease grids
          {portfolio
            ? ` · ${portfolio.classBalance.train_cells} train cells · honest block-CV AUC ${Math.max(portfolio.honestCv.lightgbm, portfolio.honestCv.random_forest).toFixed(2)} (best of LGBM/RF)`
            : ""}
        </span>
        <Badge className="ml-2 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          LABELS = PROXIMITY
        </Badge>
        <span className="text-xs text-muted-foreground">
          Model scores rank exploration priority — not certified reserves
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ---------- Regional map ---------- */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Manganese belt — Central India
            </CardTitle>
            <CardDescription>
              10 MOIL leases · click a pin to inspect its lease grid
            </CardDescription>
          </CardHeader>
          <CardContent>
            <svg
              viewBox="0 0 480 480"
              className="h-auto w-full"
              role="img"
              aria-label="Map of Madhya Pradesh and Maharashtra showing MOIL manganese mine locations"
            >
              {/* graticule */}
              {[16, 18, 20, 22, 24, 26].map((lat) => (
                <line
                  key={`h${lat}`}
                  x1={0}
                  x2={480}
                  y1={project(72, lat).y}
                  y2={project(84.5, lat).y}
                  stroke="var(--map-grid)"
                  strokeDasharray="2 6"
                  strokeWidth={1}
                />
              ))}
              {[74, 76, 78, 80, 82, 84].map((lng) => (
                <line
                  key={`v${lng}`}
                  y1={0}
                  y2={480}
                  x1={project(lng, 21).x}
                  x2={project(lng, 21).x}
                  stroke="var(--map-grid)"
                  strokeDasharray="2 6"
                  strokeWidth={1}
                />
              ))}
              {/* states */}
              <path d={toPath(MP_POLY)} className="fill-stone-100 dark:fill-stone-800/60" stroke="var(--map-stroke)" strokeWidth={1.5} strokeLinejoin="round" />
              <path d={toPath(MH_POLY)} className="fill-stone-100 dark:fill-stone-800/60" stroke="var(--map-stroke)" strokeWidth={1.5} strokeLinejoin="round" />
              {/* state labels */}
              <text x={project(78.2, 23.8).x} y={project(78.2, 23.8).y} textAnchor="middle" className="fill-stone-400 dark:fill-stone-400" fontSize={11} letterSpacing={2}>
                MADHYA PRADESH
              </text>
              <text x={project(76.2, 18.6).x} y={project(76.2, 18.6).y} textAnchor="middle" className="fill-stone-400 dark:fill-stone-400" fontSize={11} letterSpacing={2}>
                MAHARASHTRA
              </text>
              {/* belt highlight — geology context, neutral */}
              <circle
                cx={project(79.7, 21.4).x}
                cy={project(79.7, 21.4).y}
                r={52}
                fill="none"
                stroke="var(--map-stroke)"
                strokeOpacity={0.9}
                strokeDasharray="5 5"
              />
              <text x={project(79.7, 20.1).x} y={project(79.7, 20.1).y} textAnchor="middle" className="fill-stone-400 dark:fill-stone-400" fontSize={9.5} fontWeight={600} letterSpacing={1}>
                Mn BELT
              </text>
              {/* mine pins — sized by REAL estMt where available */}
              {data.mines.map((m, i) => {
                const { x, y } = project(m.lng, m.lat);
                const estMt = realByCode.get(m.code)?.estMt ?? m.stats.estMt;
                const r = 4 + Math.sqrt(estMt) * 2.4;
                const isSelected = m.id === selectedId;
                const labelUp = i % 2 === 0;
                return (
                  <g
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className="cursor-pointer"
                    role="button"
                    aria-label={`Select ${m.name}`}
                  >
                    {isSelected && (
                      <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--foreground)" strokeOpacity={0.85} strokeWidth={1.5} />
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={r}
                      fill={pinColor(m.stats.avgProb)}
                      stroke="var(--background)"
                      strokeWidth={1.5}
                    />
                    <text
                      x={x}
                      y={labelUp ? y - r - 5 : y + r + 11}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={isSelected ? 700 : 500}
                      className={isSelected ? "fill-foreground" : "fill-stone-600 dark:fill-stone-300"}
                    >
                      {m.code}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Portfolio estimate:{" "}
                <span className="font-semibold text-foreground">
                  {(realTotalMt || totalEstMt).toFixed(0)} Mt
                </span>{" "}
                {realTotalMt ? "(real satellite model)" : "(model scenario)"}
              </span>
              <span className="flex items-center gap-1.5">
                Likelihood:
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--chart-plan)" }} />
                low
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--chart-copper)" }} />
                med
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--chart-copper-deep)" }} />
                high
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ---------- Lease detail + drill targets ---------- */}
        {selected && (
          <div className="space-y-4 lg:col-span-3">
            {/* grid source toggle — REAL pipeline vs demo ops model */}
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Grid data source" className="inline-flex rounded-lg border bg-background p-1">
                <button
                  onClick={() => setGridMode("real")}
                  disabled={!selectedReal}
                  aria-pressed={gridMode === "real"}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    gridMode === "real"
                      ? "bg-green-600/10 text-green-700 dark:text-green-400 ring-1 ring-green-600/30"
                      : "text-muted-foreground hover:bg-muted/60 disabled:opacity-40"
                  }`}
                >
                  <Satellite className="h-3.5 w-3.5" aria-hidden="true" />
                  REAL satellite grid{selectedReal ? "" : " (loading)"}
                </button>
                <button
                  onClick={() => setGridMode("demo")}
                  aria-pressed={gridMode === "demo"}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    gridMode === "demo"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                  Demo ops grid
                </button>
              </div>
              <span className="text-xs text-muted-foreground">
                {showReal
                  ? "Regional pipeline: 22,420 cells · 80 Mn sites · 8 Sentinel-2 tiles"
                  : "High-res demo grid (9 × 12 · 445 m) — synthetic labels for ops walkthrough"}
              </span>
            </div>

            {showReal ? (
              <>
                <RealMineGrid mineCode={selected.code} />
                <FieldValidationPanel />
              </>
            ) : (
              <>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <Badge variant="outline" className="text-muted-foreground">
                    {selected.code}
                  </Badge>
                  <MineTypeBadge type={selected.type} />
                  <span className="text-xs text-muted-foreground">
                    {selected.district}, {selected.state} · Mn grade {selected.oreGrade}%
                  </span>
                </div>
                <CardDescription>
                  Ore-presence probability per grid cell — satellite indices + lithology
                  favorability. Hover any cell for its features.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Est. potential", value: `${selected.stats.estMt.toFixed(1)} Mt` },
                    { label: "High-potential cells", value: `${selected.stats.highPotential} / ${selected.stats.totalCells}` },
                    { label: "Mean likelihood", value: `${(selected.stats.avgProb * 100).toFixed(0)}%` },
                    { label: "Grid", value: "9 × 12 · ~445 m" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg border bg-muted/40 p-2.5 text-center">
                      <p className="text-lg font-semibold tabular-nums">{s.value}</p>
                      <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Heatmap grid */}
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Lease grid — ore likelihood heatmap
                    </p>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      0%
                      <span className="inline-block h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, var(--cell-p0), var(--hm-1), var(--hm-2), var(--hm-3), var(--hm-4), var(--hm-5))" }} />
                      100%
                    </span>
                  </div>
                  <div className="grid grid-cols-12 gap-[3px]">
                    {selected.cells.map((c) => (
                      <div
                        key={`${c.row}-${c.col}`}
                        title={`Cell (${c.row},${c.col}) · P(ore) ${(c.probability * 100).toFixed(0)}%\nNDVI ${c.ndvi.toFixed(2)} · Lithology ${c.rockMatch.toFixed(2)} · Dist-to-ore ${c.distToOre.toFixed(1)} km · LST ${c.lst.toFixed(0)}°C`}
                        className="aspect-square rounded-[3px] transition-colors hover:ring-1 hover:ring-foreground/60"
                        style={{ backgroundColor: heatColor(c.probability) }}
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Drill targets + Why-this-target */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Crosshair className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Priority drill targets — {selected.name}
                </CardTitle>
                <CardDescription>
                  Click a row for the evidence behind its score
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Cell</TableHead>
                      <TableHead className="text-right">P(ore)</TableHead>
                      <TableHead className="text-right">Lithology</TableHead>
                      <TableHead className="text-right">Dist. to ore</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected?.stats.drillTargets.map((t, i) => {
                      const isSel = selectedTarget?.row === t.row && selectedTarget?.col === t.col;
                      return (
                        <TableRow
                          key={`${t.row}-${t.col}`}
                          onClick={() => setSelectedTarget(isSel ? null : t)}
                          className={`cursor-pointer ${isSel ? "bg-muted/60" : ""}`}
                          aria-selected={isSel}
                        >
                          <TableCell className="font-medium">{i + 1}</TableCell>
                          <TableCell className="tabular-nums">
                            ({t.row}, {t.col})
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                            {(t.probability * 100).toFixed(0)}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {t.rockMatch.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {t.distToOre.toFixed(1)} km
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {selectedTarget && (
                  <div className="mt-4 rounded-lg border bg-muted/40 p-3.5">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      Why target ({selectedTarget.row}, {selectedTarget.col}) —{" "}
                      {(selectedTarget.probability * 100).toFixed(0)}% prospectivity
                    </p>
                    <div className="mt-2.5 space-y-1.5">
                      {[
                        {
                          name: "Geology — lithology favorability",
                          value: `${selectedTarget.rockMatch.toFixed(2)} (0–1)`,
                          weight: lithoW,
                          note: "Sausar-metagroup affinity of host rock",
                        },
                        {
                          name: "Occurrence context — dist. to known ore horizon",
                          value: `${selectedTarget.distToOre.toFixed(1)} km`,
                          weight: distW,
                          note: "closer scores higher (negative coefficient on distance)",
                        },
                        {
                          name: "Spectral — NDVI anomaly",
                          value: selectedTarget.ndvi.toFixed(2),
                          weight: ndviW,
                          note: "vegetation-stress proxy over manganiferous zones",
                        },
                        ...(targetCell
                          ? [
                              {
                                name: "Terrain — land surface temp",
                                value: `${targetCell.lst.toFixed(0)} °C`,
                                weight: weightOf("Land surface temp"),
                                note: "dark-stoning / exposure proxy",
                              },
                              {
                                name: "Soil moisture",
                                value: targetCell.soilMoisture.toFixed(2),
                                weight: weightOf("Soil moisture"),
                                note: "near-zero model weight — shown for completeness",
                              },
                            ]
                          : []),
                      ].map((f) => (
                        <div
                          key={f.name}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/60 pb-1.5 last:border-0"
                        >
                          <span className="text-xs text-muted-foreground">{f.name}</span>
                          <span className="text-xs font-medium tabular-nums">{f.value}</span>
                          <span className="flex w-full items-center gap-2 text-[10px] text-muted-foreground sm:w-auto">
                            <span
                              className={(f.weight ?? 0) > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
                            >
                              model weight {(f.weight ?? 0) >= 0 ? "+" : "−"}
                              {Math.abs(f.weight ?? 0).toFixed(3)}
                            </span>
                            <span className="truncate">· {f.note}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2.5 rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      Score is a ranking signal for drilling priority, never a reserve claim ·
                      demo portfolio model AUC {(data.modelInfo?.auc ?? 0).toFixed(3)} (synthetic
                      labels) · per-cell confidence not available with current validation.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
              </>
            )}
          </div>
        )}
      </div>

      {/* ---------- REAL Balaghat pipeline (collapsed evidence) ---------- */}
      <RealPipelineSection />

      {/* ---------- Demo model transparency (collapsed) ---------- */}
      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/50">
          <span className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            Demo prospectivity model — AUC {(data.modelInfo?.auc ?? 0).toFixed(3)} · weights &amp;
            methodology
          </span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Card>
            <CardContent className="space-y-3 pt-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border bg-muted/40 p-2.5 text-center">
                  <p className="text-lg font-semibold tabular-nums">
                    {(data.modelInfo?.auc ?? 0).toFixed(3)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">ROC-AUC</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-2.5 text-center">
                  <p className="text-lg font-semibold tabular-nums">
                    {((data.modelInfo?.accuracy ?? 0) * 100).toFixed(0)}%
                  </p>
                  <p className="text-[11px] text-muted-foreground">Accuracy</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-2.5 text-center">
                  <p className="text-lg font-semibold tabular-nums">
                    {data.modelInfo?.trainCells ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Train cells</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {(data.modelInfo?.features ?? []).map((f) => {
                  const maxAbs = Math.max(
                    ...(data.modelInfo?.features ?? []).map((x) => x.absImportance),
                    0.001,
                  );
                  const pct = (f.absImportance / maxAbs) * 100;
                  const negative = f.weight < 0;
                  return (
                    <div key={f.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
                      <span className="truncate text-xs text-muted-foreground">{f.name}</span>
                      <span
                        className={`text-xs tabular-nums font-medium ${negative ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                      >
                        {negative ? "−" : "+"}
                        {Math.abs(f.weight).toFixed(2)}
                      </span>
                      <div className="col-span-2 relative h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`absolute inset-y-0 right-0 rounded-full ${negative ? "bg-red-500/80" : "bg-green-500/80"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                {data.modelInfo?.algorithm} · decision-support prioritization for exploration
                planning — not a certified reserve estimate (GSI/MCI drilling validation would be
                required). Labels synthetic, anchored to belt-scale geology from GSI public maps.
              </p>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
