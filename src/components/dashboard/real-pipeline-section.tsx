"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, ChevronDown, Database } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { ErrorCard } from "@/components/dashboard/shared";
import type {
  RealPipelineBinaryMetrics,
  RealPipelineData,
  RealPipelineSource,
  RealPipelineTarget,
} from "@/lib/types";

// ---------- Static display config (labels verified against the pipeline output) ----------

const SOURCE_CHIPS: { key: string; label: string }[] = [
  { key: "mrds", label: "USGS MRDS · 55 Mn occurrences" },
  { key: "gsi_geology_2M", label: "GSI 1:2M geology · Sausar Group" },
  { key: "copernicus_dem_glo30", label: "Copernicus DEM GLO-30" },
  { key: "sentinel_2_l2a", label: "Sentinel-2 L2A · 4 scenes" },
  { key: "era5_open_meteo", label: "ERA5 weather · 400 wks" },
];

const FEATURE_LABELS: Record<string, string> = {
  sausar_frac: "Sausar Group fraction",
  gneiss_frac: "Gneiss fraction",
  other_frac: "Other lithologies fraction",
  elev_m: "Elevation",
  slope_deg: "Slope",
  ndvi: "NDVI (vegetation)",
  swir_ratio: "SWIR ratio",
  brightness: "Brightness",
};

const fmtNum = (n: number): string => n.toLocaleString("en-IN");
const fmt3 = (n: number): string => n.toFixed(3);
const fmtBrier = (b: number | null): string => (b == null ? "n/a" : b.toFixed(3));

function tierBadgeClass(tier: string): string {
  if (tier === "high")
    return "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:border-amber-600/60 dark:bg-amber-500/10 dark:text-amber-300";
  if (tier === "medium")
    return "border-amber-300/60 bg-amber-500/5 text-amber-600 dark:border-amber-700/60 dark:bg-amber-500/5 dark:text-amber-400";
  return "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400";
}

function runLabel(iso: string): string {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

// ---------- Small sub-components ----------

function SourceChip({
  label,
  source,
}: {
  label: string;
  source: RealPipelineSource | undefined;
}) {
  const body = source ? (
    <>
      <p className="font-medium leading-snug">{source.name}</p>
      {source.license && (
        <p className="mt-1 text-[11px] leading-snug">License: {source.license}</p>
      )}
      {source.note && (
        <p className="mt-1 text-[11px] leading-snug">{source.note}</p>
      )}
      {source.url && (
        <p className="mt-1 break-all text-[10px] leading-snug opacity-70">{source.url}</p>
      )}
    </>
  ) : (
    // Manifest may still be rebuilding in the background — stay honest about it.
    <p className="leading-snug">
      Source manifest entry not yet written — background fetch job rebuilding
      <span className="font-mono"> manifest.json</span>; full citation available in{" "}
      <span className="font-mono">scripts/real-pipeline</span>.
    </p>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-800 transition-colors hover:bg-green-100 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400 dark:hover:bg-green-950/70"
        >
          <Database className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
        {body}
      </TooltipContent>
    </Tooltip>
  );
}

function MetricTriple({
  title,
  m,
}: {
  title: string;
  m: RealPipelineBinaryMetrics;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium">{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-base font-semibold tabular-nums">{fmt3(m.roc_auc)}</p>
          <p className="text-[10px] text-muted-foreground">ROC-AUC</p>
        </div>
        <div>
          <p className="text-base font-semibold tabular-nums">{fmt3(m.pr_auc)}</p>
          <p className="text-[10px] text-muted-foreground">PR-AUC</p>
        </div>
        <div>
          <p className="text-base font-semibold tabular-nums">{fmtBrier(m.brier)}</p>
          <p className="text-[10px] text-muted-foreground">Brier</p>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-center">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground/70">{note}</p>
    </div>
  );
}

// ---------- Main section ----------

export function RealPipelineSection() {
  const { data, loading, error, reload } = useApi<RealPipelineData>("/api/real-pipeline");
  const [selectedTarget, setSelectedTarget] = useState<RealPipelineTarget | null>(null);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-20 rounded-lg" />
            <Skeleton className="h-20 rounded-lg" />
            <Skeleton className="h-20 rounded-lg" />
            <Skeleton className="h-20 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <ErrorCard
        message={`Real Balaghat pipeline failed to load${error ? ` — ${error}` : ""}`}
        onRetry={reload}
      />
    );
  }

  const { metrics, model, grid, topTargets, labels, validation, limitations } = data;

  const importances = Object.entries(model.randomForestImportances)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  const maxImportance = importances.length > 0 ? importances[0][1] : 1;
  const cb = metrics.classBalance;

  return (
    <Card id="real-pipeline" className="border-green-600/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database
              className="h-4 w-4 text-green-600 dark:text-green-500"
              aria-hidden="true"
            />
            Balaghat real-data pipeline
          </CardTitle>
          <Badge
            variant="outline"
            className="border-green-300 bg-green-50 font-medium text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400"
          >
            REAL PUBLIC DATA
          </Badge>
        </div>
        <CardDescription>
          Balaghat district (MP) · {data.studyArea.cellSizeDeg}° grid · run{" "}
          {runLabel(data.runUtc)} · prospectivity ranking, not reserves
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Compact outcome strip — always visible */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Cells scored"
            value={fmtNum(grid.cells_total)}
            note={`${fmtNum(grid.high)} high · ${fmtNum(grid.medium)} med`}
          />
          <StatTile
            label="Drill targets"
            value={String(topTargets.length)}
            note="ranked, awaiting review"
          />
          <StatTile
            label="Honest AUC (RF)"
            value={fmt3(metrics.honest.randomForest.roc_auc)}
            note="discovery-blind block-CV"
          />
          <StatTile
            label="Public sources"
            value="5"
            note="MRDS · GSI · DEM · S2 · ERA5"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {SOURCE_CHIPS.map((chip) => (
            <SourceChip
              key={chip.key}
              label={chip.label}
              source={data.sources[chip.key]}
            />
          ))}
        </div>

        {/* Full evidence — collapsed by default */}
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/50">
            Full evidence — validation, feature drivers, {topTargets.length} ranked targets,
            methodology
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="space-y-5">
              {/* Honest metrics + circularity trap */}
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Model performance — {metrics.honest.label}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MetricTriple title="Logistic regression" m={metrics.honest.logistic} />
                  <MetricTriple title="Random forest" m={metrics.honest.randomForest} />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Class balance: {fmtNum(cb.positive)} positive / {fmtNum(cb.negative)} negative
                  cells ({fmtNum(cb.ambiguous_excluded)} ambiguous band excluded)
                </p>

                <Alert className="mt-3 border-yellow-300/70 bg-yellow-500/5 text-yellow-900 dark:border-yellow-700/60 dark:bg-yellow-950/20 dark:text-yellow-500">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle className="text-sm">
                    Why we also show AUC 1.00 — the circularity trap
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    <p>
                      <span className="font-medium">Issue:</span> {metrics.circularityTrap.warning.issue}
                    </p>
                    <p className="mt-1">
                      <span className="font-medium">What we claim:</span>{" "}
                      {metrics.circularityTrap.warning.what_we_claim}
                    </p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      With proximity feature (circular, muted on purpose): logistic ROC-AUC{" "}
                      {fmt3(metrics.circularityTrap.logistic.roc_auc)} · PR-AUC{" "}
                      {fmt3(metrics.circularityTrap.logistic.pr_auc)} · Brier{" "}
                      {fmtBrier(metrics.circularityTrap.logistic.brier)}; random forest ROC-AUC{" "}
                      {fmt3(metrics.circularityTrap.randomForest.roc_auc)} · PR-AUC{" "}
                      {fmt3(metrics.circularityTrap.randomForest.pr_auc)} · Brier{" "}
                      {fmtBrier(metrics.circularityTrap.randomForest.brier)}. Prior-only baseline
                      (score = −distance): ROC-AUC {fmt3(metrics.priorOnly.roc_auc)} · PR-AUC{" "}
                      {fmt3(metrics.priorOnly.pr_auc)} · Brier {fmtBrier(metrics.priorOnly.brier)} —{" "}
                      {metrics.priorOnly.note}.
                    </p>
                  </AlertDescription>
                </Alert>
              </div>

              {/* What drives the score */}
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  What drives the score — random-forest importances
                </p>
                <div className="space-y-1.5">
                  {importances.map(([key, value]) => (
                    <div
                      key={key}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5"
                      title={`${key} = ${(value * 100).toFixed(1)}% (univariate AUC ${fmt3(
                        model.featureUnivariateAuc[key] ?? 0,
                      )})`}
                    >
                      <span className="truncate text-xs text-muted-foreground">
                        {FEATURE_LABELS[key] ?? key}
                      </span>
                      <span className="text-xs font-medium tabular-nums text-green-700 dark:text-green-400">
                        {(value * 100).toFixed(1)}%
                      </span>
                      <div
                        className="relative col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"
                        role="img"
                        aria-label={`${FEATURE_LABELS[key] ?? key}: ${(value * 100).toFixed(1)}% importance`}
                      >
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-green-500/80"
                          style={{ width: `${(value / maxImportance) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Map model: {model.mapModel} — importances sum to 100%; geology + terrain
                  (elevation, slope) dominate, spectral indices refine.
                </p>
              </div>

              {/* Top exploration targets */}
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Top exploration targets — {topTargets.length} ranked cells (click for evidence)
                </p>
                <div className="max-h-64 overflow-y-auto overflow-x-auto nice-scroll rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Prospectivity</TableHead>
                        <TableHead>Host lithology</TableHead>
                        <TableHead>Nearest known site</TableHead>
                        <TableHead className="text-right">Novelty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topTargets.map((t: RealPipelineTarget, i: number) => {
                        const isSel =
                          selectedTarget?.lat === t.lat && selectedTarget?.lon === t.lon;
                        return (
                        <TableRow
                          key={`${t.lat}-${t.lon}`}
                          onClick={() => setSelectedTarget(isSel ? null : t)}
                          className={`cursor-pointer ${isSel ? "bg-muted/60" : ""}`}
                          aria-selected={isSel}
                        >
                          <TableCell className="font-medium">{i + 1}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {t.lat.toFixed(3)}°N, {t.lon.toFixed(3)}°E
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5">
                              <Badge variant="outline" className={`px-1.5 text-[10px] ${tierBadgeClass(t.tier)}`}>
                                {t.tier}
                              </Badge>
                              <span className="font-semibold tabular-nums">
                                {(t.prospectivity * 100).toFixed(0)}%
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {t.host_litho}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {t.nearest_known_site} ·{" "}
                            <span className="tabular-nums">{t.dist_to_nearest_km.toFixed(1)} km</span>{" "}
                            · {t.nearest_dev_status}
                          </TableCell>
                          <TableCell className="text-right text-[11px] text-muted-foreground">
                            {t.novelty.replace("<=", "≤")}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Why-this-target detail panel (real pipeline) */}
                {selectedTarget && (
                  <div className="mt-3 rounded-lg border bg-muted/40 p-3.5">
                    <p className="text-sm font-semibold">
                      Why target #{topTargets.findIndex(
                        (t) => t.lat === selectedTarget.lat && t.lon === selectedTarget.lon,
                      ) + 1}{" "}
                      — {selectedTarget.lat.toFixed(4)}°N, {selectedTarget.lon.toFixed(4)}°E
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Prospectivity
                        </p>
                        <p className="text-base font-bold tabular-nums text-foreground">
                          {(selectedTarget.prospectivity * 100).toFixed(0)}%{" "}
                          <span className="text-[11px] font-normal text-muted-foreground">
                            ({selectedTarget.tier} tier)
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Host lithology
                        </p>
                        <p className="text-sm font-medium">{selectedTarget.host_litho} group</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Elevation
                        </p>
                        <p className="text-sm font-medium tabular-nums">{selectedTarget.elev_m} m</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Occurrence context
                        </p>
                        <p className="text-sm font-medium">
                          {selectedTarget.dist_to_nearest_km.toFixed(1)} km from{" "}
                          {selectedTarget.nearest_known_site}{" "}
                          <span className="text-muted-foreground">
                            ({selectedTarget.nearest_dev_status})
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Novelty
                        </p>
                        <p className="text-sm font-medium">
                          {selectedTarget.novelty.replace("<=", "≤")}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Data provenance
                        </p>
                        <p className="text-sm font-medium text-green-700 dark:text-green-400">
                          100% public real (MRDS · GSI · DEM · S2 · ERA5)
                        </p>
                      </div>
                    </div>
                    <p className="mt-2.5 rounded-md bg-muted/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      Validation status: discovery-blind spatial block-CV, honest AUC{" "}
                      {metrics.honest.randomForest.roc_auc.toFixed(2)} (RF) — the score is a ranking
                      signal for drill-budget prioritization, not a reserve claim. Per-cell confidence
                      is not available with current validation. Geology + terrain dominate the score
                      (see importances above); a {selectedTarget.host_litho} host and proximity to a{" "}
                      {selectedTarget.nearest_dev_status.toLowerCase()} are the main supporting
                      evidence.
                    </p>
                  </div>
                )}
              </div>

              {/* Methodology & limitations */}
              <div className="border-t pt-3 text-xs leading-relaxed">
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 font-medium">Label rules (derived, not ground truth)</p>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>
                        <span className="font-medium text-foreground">Positive:</span>{" "}
                        {labels.positive_rule}
                      </li>
                      <li>
                        <span className="font-medium text-foreground">Negative:</span>{" "}
                        {labels.negative_rule}
                      </li>
                      <li>
                        <span className="font-medium text-foreground">Excluded:</span>{" "}
                        {labels.excluded_band}
                      </li>
                      <li className="text-yellow-700 dark:text-yellow-500">{labels.caveat}</li>
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 font-medium">Validation</p>
                    <p className="text-muted-foreground">
                      {validation.spatial_block_cv} — {validation.why}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Tier cut-offs: high ≥ {model.tierThresholds.high_min.toFixed(2)}, medium ≥{" "}
                      {model.tierThresholds.medium_min.toFixed(2)} ({model.tierThresholds.basis}).
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 font-medium">Limitations</p>
                    <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                      {limitations.map((lim, i) => (
                        <li key={i}>{lim}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground">
                Reproducible via scripts/real-pipeline (Python) · {data.provenance.data}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
