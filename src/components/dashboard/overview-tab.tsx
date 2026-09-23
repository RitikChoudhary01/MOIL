"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
} from "recharts";
import {
  TrendingUp,
  CalendarClock,
  AlertTriangle,
  Crosshair,
  ClipboardCheck,
  ChevronDown,
  ArrowRight,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { KpiCard, StatusBadge } from "@/components/dashboard/shared";
import { useApi } from "@/hooks/use-api";
import type {
  OverviewData,
  ProductionData,
  RecommendationItem,
  RealPipelineData,
  Mine,
} from "@/lib/types";
import { fmtT, fmtDate } from "@/lib/types";

// MOIL Terra chart palette — theme-aware CSS vars (see globals.css)
const CHART = {
  actual: "var(--chart-ink)",
  target: "var(--chart-plan)",
  predicted: "var(--chart-copper)",
};

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number | null; color: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {payload
        .filter((p) => p.value != null)
        .map((p) => (
          <p key={p.name} className="flex items-center gap-1.5 tabular-nums">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
            {p.name}: {fmtT(p.value ?? 0)} t
          </p>
        ))}
    </div>
  );
}

export function OverviewTab({
  data,
  production = null,
  recs = null,
  onNavigate,
  mines = [],
}: {
  data: OverviewData;
  production?: ProductionData | null;
  recs?: RecommendationItem[] | null;
  onNavigate?: (tab: string) => void;
  mines?: Mine[];
}) {
  const { kpis, monthly, forecastMonths, topRisks, insights, modelPerformance } = data;
  const real = useApi<RealPipelineData>("/api/real-pipeline");

  // ---------- Region filter state ----------
  const states = useMemo(() => {
    const s = new Set(mines.map((m) => m.state));
    return [...s].sort();
  }, [mines]);
  const [regionFilter, setRegionFilter] = useState<string>("all");

  // Map mineCode → state for filtering topRisks
  const codeToState = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mines) map.set(m.code, m.state);
    return map;
  }, [mines]);

  // Filter topRisks by selected region
  const filteredTopRisks = useMemo(() => {
    if (regionFilter === "all") return topRisks;
    return topRisks.filter((r) => codeToState.get(r.mineCode) === regionFilter);
  }, [topRisks, regionFilter, codeToState]);

  // Compute region-specific KPIs when a region is selected
  const regionKpis = useMemo(() => {
    if (regionFilter === "all" || !production) return null;
    const regionMines = production.mines.filter(
      (m) => m.state === regionFilter,
    );
    if (regionMines.length === 0) return null;

    // Last month actual/target from most recent 4 weeks of weekly data
    let lastMonthActual = 0;
    let lastMonthTarget = 0;
    let nextMonthPredicted = 0;
    let nextMonthTarget = 0;
    let atRiskMines = 0;
    const mineCount = regionMines.length;

    for (const m of regionMines) {
      // Use last 4 weeks as approximation for "last month"
      const last4 = m.weekly.slice(-4);
      for (const w of last4) {
        lastMonthActual += w.actual;
        lastMonthTarget += w.target;
      }
      for (const f of m.forecast) {
        nextMonthPredicted += f.predicted;
        nextMonthTarget += f.target;
      }
      if (m.forecast.some((f) => f.status === "risk")) atRiskMines++;
    }

    const lastMonthAchievementPct = lastMonthTarget > 0
      ? (lastMonthActual / lastMonthTarget) * 100
      : 0;

    // Count active risks and watch in this region from topRisks
    const regionRisks = topRisks.filter(
      (r) => codeToState.get(r.mineCode) === regionFilter,
    );
    const activeRisks = regionRisks.filter((r) => r.status === "risk").length;
    const watchCount = regionRisks.filter((r) => r.status === "watch").length;

    // Filter recs for this region
    const regionRecs = recs
      ? recs.filter((r) => {
          const mineState = mines.find((m) => m.code === r.mineCode)?.state;
          return mineState === regionFilter && r.status === "proposed";
        })
      : [];
    const proposedRecs = regionRecs.length || kpis.proposedRecs;
    const potentialRecovery = regionRecs.length > 0
      ? regionRecs.reduce((a, r) => a + r.impactTonnes, 0)
      : kpis.potentialRecovery;

    return {
      lastMonthActual,
      lastMonthTarget,
      lastMonthAchievementPct,
      nextMonthPredicted,
      nextMonthTarget,
      atRiskMines,
      totalMines: mineCount,
      activeRisks,
      watchCount,
      proposedRecs,
      potentialRecovery,
      ...kpis, // spread for fields we don't recompute
    };
  }, [regionFilter, production, topRisks, codeToState, recs, mines, kpis]);

  // Use region KPIs if available, otherwise original
  const activeKpis = regionKpis ?? kpis;

  // Dominant negative OPERATIONAL driver aggregated across all predicted weeks
  const dominantDriver = (() => {
    if (!production) return null;
    const totals = new Map<string, number>();
    for (const m of production.mines)
      for (const f of m.forecast)
        for (const fac of f.factors)
          if (fac.contribution < 0 && fac.name !== "Planned target")
            totals.set(fac.name, (totals.get(fac.name) ?? 0) + fac.contribution);
    const entries = [...totals.entries()].sort((a, b) => a[1] - b[1]);
    return entries.length > 0
      ? { name: entries[0][0], tonnes: Math.abs(entries[0][1]) }
      : null;
  })();
  const predictedWeeks = production
    ? production.mines.reduce((a, m) => a + m.forecast.length, 0)
    : 0;

  const proposedRecs = recs?.filter((r) => r.status === "proposed") ?? null;
  const proposedCount = proposedRecs?.length ?? activeKpis.proposedRecs;
  const proposedTonnes = proposedRecs
    ? proposedRecs.reduce((a, r) => a + r.impactTonnes, 0)
    : activeKpis.potentialRecovery;

  // Merge history + forecast months (dedupe by month key)
  const byKey = new Map<
    string,
    { month: string; key: string; actual: number | null; target: number | null; predicted: number | null }
  >();
  for (const m of monthly) {
    byKey.set(m.key, { month: m.month, key: m.key, actual: m.actual, target: m.target, predicted: m.fitted });
  }
  for (const f of forecastMonths) {
    const existing = byKey.get(f.key);
    if (existing) {
      existing.predicted = f.predicted;
    }
    else
      byKey.set(f.key, {
        month: f.month,
        key: f.key,
        actual: null,
        target: f.target,
        predicted: f.predicted,
      });
  }
  const chartData = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const forecastStartIdx = chartData.findIndex((d) => d.predicted != null);
  const forecastStartKey = forecastStartIdx >= 0 ? chartData[forecastStartIdx].key : undefined;

  const nextGap = activeKpis.nextMonthPredicted - activeKpis.nextMonthTarget;
  const nextPct = (activeKpis.nextMonthPredicted / Math.max(activeKpis.nextMonthTarget, 1)) * 100;

  return (
    <div className="space-y-6">
      {/* ---------- SIH Hero Banner ---------- */}
      <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-950/60 via-stone-900/80 to-background p-6 dark:from-amber-950/40">
        {/* Decorative ore-vein lines */}
        <div className="pointer-events-none absolute inset-0 opacity-10" aria-hidden="true">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <line x1="0" y1="40%" x2="100%" y2="55%" stroke="#c17434" strokeWidth="1" strokeDasharray="6 4"/>
            <line x1="0" y1="65%" x2="100%" y2="75%" stroke="#c17434" strokeWidth="0.5" strokeDasharray="3 6"/>
          </svg>
        </div>
        <div className="relative grid grid-cols-1 gap-6 sm:grid-cols-3">
          {/* Problem */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">Problem · PS SIH26-26009</p>
            <p className="text-sm font-medium leading-snug text-white/90">
              MOIL operates 10 manganese mines across MP &amp; Maharashtra with no unified AI decision layer — shortfalls go undetected until the week they occur.
            </p>
          </div>
          {/* Solution */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">Solution · 3 Modules</p>
            <ul className="space-y-0.5 text-sm text-white/80">
              <li><span className="font-semibold text-amber-400">A</span> Prospectivity mapping — satellite + geology</li>
              <li><span className="font-semibold text-amber-400">B</span> 4-week shortfall forecast — explainable ML</li>
              <li><span className="font-semibold text-amber-400">C</span> Action engine — ranked corrective actions</li>
            </ul>
          </div>
          {/* Key metric */}
          <div className="flex flex-col justify-center rounded-lg border border-amber-500/20 bg-amber-900/20 p-4 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">Model accuracy</p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-amber-300">0.928</p>
            <p className="text-xs text-white/60">R² · rolling-origin CV · 4,000 mine-weeks</p>
            <p className="mt-2 text-[10px] text-white/50">MAPE 11.6% · AUC 0.88 (spatial block CV)</p>
          </div>
        </div>
      </div>

      {/* ---------- Data provenance badges ---------- */}
      <div className="flex flex-wrap items-start gap-3 rounded-lg bg-muted/40 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-wrap gap-3">
          <Badge variant="outline" className="gap-1.5 border-green-600/40 bg-green-50 text-green-700 dark:border-green-500/40 dark:bg-green-950/30 dark:text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-600 dark:bg-green-400" />
            REAL WEATHER
          </Badge>
          <span className="self-center text-xs text-muted-foreground">ERA5 reanalysis (2019–2026)</span>
          <Badge variant="outline" className="gap-1.5 border-amber-600/40 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
            SYNTHETIC OPS
          </Badge>
          <span className="self-center text-xs text-muted-foreground">Site-level production &amp; equipment data modeled on MOIL public aggregates</span>
        </div>
      </div>

      {/* ---------- Region filter ---------- */}
      {states.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">Region:</span>
          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="All regions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All regions</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {regionFilter !== "all" && (
            <span className="text-xs text-muted-foreground">
              Showing {regionFilter} — {mines.filter((m) => m.state === regionFilter).length} mine{mines.filter((m) => m.state === regionFilter).length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* ---------- KPI strip: one number per decision question ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Production · last month"
          value={fmtT(activeKpis.lastMonthActual)}
          unit="t"
          icon={TrendingUp}
          trend={activeKpis.lastMonthAchievementPct >= 98 ? "up" : "down"}
          subtext={`${activeKpis.lastMonthAchievementPct.toFixed(1)}% of ${fmtT(activeKpis.lastMonthTarget)} t plan`}
          subtextTone={activeKpis.lastMonthAchievementPct >= 98 ? "positive" : "warning"}
          animationDelay={0}
        />
        <KpiCard
          title="Forecast · next 4 weeks"
          value={fmtT(activeKpis.nextMonthPredicted)}
          unit="t"
          icon={CalendarClock}
          trend={nextGap < 0 ? "down" : "up"}
          subtext={`${nextPct.toFixed(1)}% of plan · ${nextGap < 0 ? "−" : "+"}${fmtT(Math.abs(nextGap))} t · ${activeKpis.atRiskMines}/${activeKpis.totalMines} mines at risk`}
          subtextTone={nextGap < 0 ? "negative" : "positive"}
          animationDelay={100}
        />
        <KpiCard
          title="Exploration · ranked targets"
          value={real.data ? String(real.data.topTargets.length) : "—"}
          unit={real.data ? "targets" : undefined}
          icon={Crosshair}
          trend="up"
          subtext={
            real.data
              ? `${real.data.grid.high} high-priority cells · real Balaghat pipeline`
              : "Real Balaghat pipeline loading…"
          }
          animationDelay={200}
        />
        <KpiCard
          title="Actions · awaiting review"
          value={String(proposedCount)}
          unit="proposed"
          icon={ClipboardCheck}
          trend={proposedCount > 0 ? "up" : "neutral"}
          subtext={`+${fmtT(proposedTonnes)} t estimated recovery (rule engine, capped)`}
          subtextTone="positive"
          animationDelay={300}
        />
      </div>

      {/* ---------- Portfolio production chart ---------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Portfolio production — actual vs plan vs forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--chart-grid)" }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "transparent" }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {forecastStartKey && (
                  <ReferenceArea
                    x1={chartData[forecastStartIdx]?.month}
                    x2={chartData[chartData.length - 1]?.month}
                    fill="var(--chart-zone)"
                    stroke="var(--chart-copper)"
                    strokeOpacity={0.25}
                    strokeDasharray="4 4"
                    label={{
                      value: "Forecast →",
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: "var(--chart-copper-deep)",
                    }}
                  />
                )}
                <Bar dataKey="actual" name="Actual" fill={CHART.actual} radius={[3, 3, 0, 0]} maxBarSize={26} />
                <Bar dataKey="target" name="Plan target" fill={CHART.target} radius={[3, 3, 0, 0]} maxBarSize={26} />
                <Bar dataKey="predicted" name="Predicted (model)" fill={CHART.predicted} radius={[3, 3, 0, 0]} maxBarSize={26} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Attention list + model status ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Needs attention</CardTitle>
              <span className="text-xs text-muted-foreground">
                {activeKpis.activeRisks} risk · {activeKpis.watchCount} watch flags · top {Math.min(filteredTopRisks.length, 5)} shown
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {filteredTopRisks.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <StatusBadge status={r.status} />
                  <span className="text-sm font-medium">{r.mineName}</span>
                  <span className="text-xs text-muted-foreground">
                    wk {fmtDate(r.weekStart)} · H{r.horizon}
                  </span>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                    {fmtT(r.predicted)} / {fmtT(r.target)} t
                  </span>
                  <span className="w-24 text-right text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
                    −{fmtT(Math.abs(r.gap))} t
                  </span>
                </div>
              ))}
              {filteredTopRisks.length === 0 && regionFilter !== "all" && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No flagged predictions for {regionFilter}
                </p>
              )}
            </div>
            {onNavigate && (
              <button
                onClick={() => onNavigate("risks")}
                className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                All flagged predictions &amp; root causes
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Model status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-semibold tabular-nums">
                  {(modelPerformance?.metrics.r2 ?? 0).toFixed(3)}
                </p>
                <p className="text-[11px] text-muted-foreground">R² · rolling CV</p>
              </div>
              <div>
                <p className="text-lg font-semibold tabular-nums">
                  {fmtT(modelPerformance?.metrics.mae ?? 0)}
                </p>
                <p className="text-[11px] text-muted-foreground">MAE t/week</p>
              </div>
              <div>
                <p className="text-lg font-semibold tabular-nums">
                  {(modelPerformance?.metrics.mape ?? 0).toFixed(1)}%
                </p>
                <p className="text-[11px] text-muted-foreground">MAPE/week</p>
              </div>
            </div>
            <div className="space-y-1.5 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                {modelPerformance?.algorithm ?? "Model"} ·{" "}
                {fmtT(modelPerformance?.metrics.trainSamples ?? 0)} mine-weeks ·{" "}
                {modelPerformance?.backtestNote}
              </p>
              {dominantDriver && (
                <p>
                  Dominant negative driver:{" "}
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {dominantDriver.name} (−{fmtT(dominantDriver.tonnes)} t
                  </span>{" "}
                  across {predictedWeeks} predicted weeks)
                </p>
              )}
            </div>
            {/* Methodology note */}
            <p className="rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium">Methodology:</span> Ridge regression (gradient descent, standardized features) with rolling-origin cross-validation. Factor attribution: exact linear-SHAP. Balaghat prospectivity: logistic regression + random forest on public satellite/geological proxies with spatial block CV.
            </p>
            {onNavigate && (
              <button
                onClick={() => onNavigate("health")}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                Full model &amp; data audit
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Domain insights (collapsed) ---------- */}
      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/50">
          Domain insights from the data
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {insights.map((insight, i) => (
              <p
                key={i}
                className="rounded-lg border p-3 text-xs leading-relaxed text-foreground/90"
              >
                {insight}
              </p>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
