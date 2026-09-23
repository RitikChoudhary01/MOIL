"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BrainCircuit, MapPin, Database, ShieldCheck, CalendarClock, Activity } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { ErrorCard } from "@/components/dashboard/shared";
import type { ProductionData, ReserveMapData, RealPipelineData } from "@/lib/types";
import { fmtT } from "@/lib/types";

function fmtUtc(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium leading-snug">{value}</span>
    </div>
  );
}

function ModelCard({
  title,
  icon: Icon,
  subtitle,
  children,
  badge,
}: {
  title: string;
  icon: typeof BrainCircuit;
  subtitle: string;
  children: React.ReactNode;
  badge?: { text: string; className: string };
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">{title}</CardTitle>
          {badge && (
            <Badge variant="outline" className={badge.className}>
              {badge.text}
            </Badge>
          )}
        </div>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// Dataset provenance (verified in audit — values from live DB/artifacts)
const DATASETS: {
  name: string;
  source: string;
  type: string;
  usedBy: string;
  verified: string;
}[] = [
  {
    name: "Mn occurrences (labels)",
    source: "USGS MRDS (WFS)",
    type: "REAL PUBLIC",
    usedBy: "Real-pipeline training labels",
    verified: "manifest.json · 55 records in AOI",
  },
  {
    name: "Lithology (Sausar/…)",
    source: "GSI 1:2M via Esri Living Atlas",
    type: "REAL PUBLIC",
    usedBy: "Prospectivity features",
    verified: "manifest.json",
  },
  {
    name: "Elevation / slope",
    source: "Copernicus DEM GLO-30",
    type: "REAL PUBLIC (derived)",
    usedBy: "Prospectivity features",
    verified: "manifest.json · S3 COG",
  },
  {
    name: "NDVI / SWIR indices",
    source: "Sentinel-2 L2A (earth-search STAC)",
    type: "REAL PUBLIC (derived)",
    usedBy: "Prospectivity features",
    verified: "manifest.json · 4 scenes",
  },
  {
    name: "Weekly weather 2019–2026",
    source: "ERA5 reanalysis (Open-Meteo)",
    type: "REAL PUBLIC",
    usedBy: "Production features (3 of 10)",
    verified: "per-mine, 400 weeks × 10",
  },
  {
    name: "Mine portfolio (10 leases)",
    source: "MOIL public reports",
    type: "REAL PUBLIC",
    usedBy: "Mine attributes",
    verified: "7 UG + 3 OP · grades 28–40%",
  },
  {
    name: "Weekly ops records (4,000)",
    source: "Simulation (seed 42, deterministic)",
    type: "SYNTHETIC (labeled)",
    usedBy: "Production features/target",
    verified: "no public source exists (SEBI/IBM checked)",
  },
  {
    name: "Demo cell grid (1,080)",
    source: "Simulation anchored to belt geology",
    type: "SYNTHETIC (labeled)",
    usedBy: "Demo prospectivity model",
    verified: "labeled PROTOTYPE on screen",
  },
  {
    name: "Predictions (40) · recs (38)",
    source: "Trained ridge + rule engine",
    type: "MODEL OUTPUT",
    usedBy: "All risk/action UI",
    verified: "retrain reproduces to 0.0004",
  },
  {
    name: "156.6 Mt figure",
    source: "Scenario calc (cells × area × grade range)",
    type: "ILLUSTRATIVE",
    usedBy: "Overview KPI",
    verified: "labeled — never a reserve",
  },
];

interface ProspectivitySummary {
  modelVersion: string;
  provenance: { data: string; scores: string; metrics: string };
  classBalance: { train_cells: number; positives: number; negatives: number };
  honestCv: {
    scheme: string;
    logistic: number;
    random_forest: number;
    lightgbm: number;
    lightgbm_pu: number;
    mlp?: number;
  };
  circularCv: { logistic_auc: number; random_forest_auc: number } | null;
  circularCvNote?: string;
  reliabilityBins: { bin: string; n: number; mean_predicted: number; observed_rate: number }[] | null;
  mapModel: { ensemble: string; champion: string; tier_thresholds: { high_min: number; medium_min: number; basis: string } };
  mines: { code: string; cellsTotal: number }[];
  sentinelScenes: { tile: string }[];
  runUtc: string;
}

interface DriftFeature { feature: string; psi: number; verdict: string; expectedMean: number; actualMean: number; }
interface DriftData {
  method: string; verdict: string; retrainRecommended: boolean;
  baselineWindow: { from: string; to: string; n: number };
  recentWindow: { from: string; to: string; n: number };
  features: DriftFeature[]; note: string;
}

function DriftCard() {
  const drift = useApi<DriftData>("/api/drift");
  const tone =
    drift.data?.verdict === "significant"
      ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
      : drift.data?.verdict === "moderate"
        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-500"
        : "border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400";
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Data drift monitor (Module B)
        </CardTitle>
        <CardDescription>
          Population Stability Index — training-history window vs the most recent 12 mine-weeks,
          computed live from the warehouse. &lt;0.10 stable · 0.10–0.25 moderate · &gt;0.25 retrain.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {drift.loading ? (
          <p className="text-xs text-muted-foreground">Computing PSI…</p>
        ) : drift.error || !drift.data ? (
          <p className="text-xs text-muted-foreground">Drift analysis unavailable ({drift.error ?? "no data"}).</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`capitalize ${tone}`}>
                {drift.data.verdict}
              </Badge>
              {drift.data.retrainRecommended && (
                <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400">
                  retrain recommended
                </Badge>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                baseline {drift.data.baselineWindow.from} → {drift.data.baselineWindow.to} (n={drift.data.baselineWindow.n}) · recent n={drift.data.recentWindow.n}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto nice-scroll rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-right">PSI</TableHead>
                    <TableHead className="text-right">Train μ → Recent μ</TableHead>
                    <TableHead className="text-right">Verdict</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drift.data.features.map((f) => (
                    <TableRow key={f.feature}>
                      <TableCell className="font-medium">{f.feature}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.psi.toFixed(3)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {f.expectedMean.toFixed(1)} → {f.actualMean.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right text-xs capitalize">{f.verdict}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{drift.data.note}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ModelHealthTab({
  production,
  reserve,
}: {
  production: ProductionData;
  reserve: ReserveMapData;
}) {
  const real = useApi<RealPipelineData>("/api/real-pipeline");
  const regional = useApi<ProspectivitySummary>("/api/prospectivity");
  const pm = production.modelPerformance;
  const rm = reserve.modelInfo;

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-500" aria-hidden="true" />
        <p className="text-xs leading-relaxed">
          Technical transparency for every prediction on this dashboard — model, data source,
          validation status, and freshness. Synthetic layers are labeled synthetic; only
          MOIL&apos;s own records can upgrade them to REAL, and the swap is designed in.
        </p>
      </div>

      {/* Model cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ModelCard
          title="Production Forecast"
          icon={BrainCircuit}
          subtitle="Module B — 4-week mine-week prediction"
          badge={{
            text: "PROTOTYPE (synthetic ops)",
            className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-500",
          }}
        >
          <StatusRow label="Model" value={pm?.algorithm ?? "Ridge regression (gradient descent)"} />
          <StatusRow
            label="Data"
            value="4,000 mine-weeks · weather REAL ERA5 · ops SYNTHETIC (labeled)"
          />
          <StatusRow
            label="Validation"
            value={`Rolling-origin 3 folds × 52 wks (test n=${fmtT(pm?.metrics.testSamples ?? 0)}) · R² ${(pm?.metrics.r2 ?? 0).toFixed(3)} · MAPE ${(pm?.metrics.mape ?? 0).toFixed(2)}%`}
          />
          {pm?.riskBands && (
            <StatusRow
              label="Risk bands"
              value={`Per-mine split-conformal P10–P90 — ${(pm.riskBands.coverage80 * 100).toFixed(1)}% of held-out weeks inside the band (nominal 80%, disjoint window)`}
            />
)}
          <StatusRow
            label="Explainability"
            value="Coefficient-based contributions (exact linear-SHAP: φ = w·(x−μ)/σ) — sums to prediction"
          />
          <StatusRow label="Last trained" value={pm?.trainedAt ? fmtUtc(pm.trainedAt) : "—"} />
        </ModelCard>

        <ModelCard
          title="Prospectivity (demo portfolio)"
          icon={MapPin}
          subtitle="Module A — 10-lease demonstration grid"
          badge={{
            text: "PROTOTYPE",
            className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-500",
          }}
        >
          <StatusRow label="Model" value={rm?.algorithm ?? "Logistic regression"} />
          <StatusRow
            label="Data"
            value={`${rm?.trainCells ?? 0} train cells (70/30) · synthetic labels anchored to GSI belt geology`}
          />
          <StatusRow
            label="Validation"
            value={`Standard split AUC ${(rm?.auc ?? 0).toFixed(3)} · accuracy ${((rm?.accuracy ?? 0) * 100).toFixed(0)}% — research-grade validation on the real pipeline →`}
          />
          <StatusRow label="Explainability" value="Signed feature weights on screen" />
          <StatusRow label="Last trained" value={rm?.trainedAt ? fmtUtc(rm.trainedAt) : "—"} />
        </ModelCard>

        <ModelCard
          title="Prospectivity (REAL — regional)"
          icon={Database}
          subtitle="ALL 10 mines — one regional pipeline · 5 public sources"
          badge={{
            text: "REAL PUBLIC DATA",
            className:
              "border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400",
          }}
        >
          {regional.loading ? (
            <p className="text-xs text-muted-foreground">Loading pipeline metrics…</p>
          ) : regional.error || !regional.data ? (
            <ErrorCard message="Regional pipeline failed to load" onRetry={regional.reload} />
          ) : (
            <>
              <StatusRow
                label="Models"
                value={`${regional.data.mapModel?.champion ?? "ensemble"} leads · map = ${regional.data.mapModel?.ensemble ?? "—"}`}
              />
              <StatusRow
                label="Data"
                value={`${regional.data.classBalance.train_cells.toLocaleString("en-IN")} train cells @ 0.01° (~1.1 km) · ${regional.data.classBalance.positives}+/${regional.data.classBalance.negatives.toLocaleString("en-IN")}− labels · ${regional.data.sentinelScenes.length} Sentinel-2 tiles`}
              />
              <StatusRow
                label="Validation"
                value={`Discovery-blind spatial block-CV — AUC ${regional.data.honestCv.lightgbm.toFixed(3)} (LightGBM) · ${regional.data.honestCv.lightgbm_pu.toFixed(3)} (LGBM-PU) · ${regional.data.honestCv.random_forest.toFixed(3)} (RF) · ${regional.data.honestCv.mlp?.toFixed(3) ?? "n/a"} (MLP neural net) · ${regional.data.honestCv.logistic.toFixed(3)} (LR) · proximity excluded`}
              />
              {regional.data.reliabilityBins && regional.data.reliabilityBins.length > 0 && (
                <StatusRow
                  label="Calibration"
                  value={`Isotonic on out-of-fold scores · reliability bins: ${regional.data.reliabilityBins.map((b) => `${(b.observed_rate * 100).toFixed(0)}% obs @ ${(b.mean_predicted * 100).toFixed(0)}% pred`).join(" · ")}`}
                />
              )}
              <StatusRow
                label="Known issue (v1 demo)"
                value={regional.data.circularCv ? `With proximity feature AUC = ${regional.data.circularCv.random_forest_auc.toFixed(2)} (circular trap) — exposed, never used by v2` : "v1 circularity demo archived"}
              />
              <StatusRow
                label="Pilot note"
                value={real.error ? "Balaghat v1 pilot unavailable" : `Superseded single-lease Balaghat pilot: AUC ${real.data ? real.data.metrics.honest.randomForest.roc_auc.toFixed(3) : "—"} → regional upgrade`}
              />
              <StatusRow label="Pipeline run" value={fmtUtc(regional.data.runUtc)} />
            </>
          )}
        </ModelCard>
      </div>

      {/* Dataset provenance table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Dataset provenance — every layer, its source, and its type
          </CardTitle>
          <CardDescription>
            The honesty system in table form: nothing synthetic is presented as MOIL real data;
            nothing model-generated is presented as measurement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto nice-scroll rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                <TableRow>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DATASETS.map((d) => (
                  <TableRow key={d.name}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-muted-foreground">{d.source}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          d.type.startsWith("REAL")
                            ? "border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400"
                            : d.type === "MODEL OUTPUT"
                              ? "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : d.type === "ILLUSTRATIVE"
                                ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400"
                                : "border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-500"
                        }
                      >
                        {d.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.usedBy}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{d.verified}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Weather fetched 2026-08-26 (ERA5 archive) · production model retrainable in seconds
            (ridge, deterministic seed 42) · real-pipeline artifacts are read-only research
            outputs with a recorded manifest.
          </p>
        </CardContent>
      </Card>

      {/* Drift monitor */}
      <DriftCard />
    </div>
  );
}
