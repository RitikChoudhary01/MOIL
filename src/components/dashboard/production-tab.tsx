"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BrainCircuit, FlaskConical, Landmark } from "lucide-react";
import { StatusBadge, FactorBars, ConfidenceMeter, MineTypeBadge } from "@/components/dashboard/shared";
import { ScenarioLab } from "@/components/dashboard/scenario-lab";
import { VerifiedRecordPanel } from "@/components/dashboard/verified-record-panel";
import type { ProductionData, ForecastPoint } from "@/lib/types";
import { fmtT, fmtDate } from "@/lib/types";

const DEFAULT_WEEKS = 26;

const TIME_OPTIONS: { value: string; label: string; weeks: number }[] = [
  { value: "26", label: "Last 26 weeks", weeks: 26 },
  { value: "13", label: "Last 13 weeks", weeks: 13 },
  { value: "52", label: "Last 52 weeks", weeks: 52 },
];

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number | null; color: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">wk of {label}</p>
      {payload
        .filter((p) => p.value != null && !(p.name.startsWith("Rainfall") && p.value === 0))
        .map((p) => (
          <p key={p.name} className="flex items-center gap-1.5 tabular-nums">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
            {p.name}: {p.name.startsWith("Rainfall") ? `${p.value} mm` : `${fmtT(p.value ?? 0)} t`}
          </p>
        ))}
    </div>
  );
}

export function ProductionTab({ data }: { data: ProductionData }) {
  const [mineFilter, setMineFilter] = useState<string>("all");
  const [showRain, setShowRain] = useState(true);
  const [timeRange, setTimeRange] = useState<string>("26");

  const weeksShown = TIME_OPTIONS.find((t) => t.value === timeRange)?.weeks ?? DEFAULT_WEEKS;

  const selected = data.mines.find((m) => m.id === mineFilter);

  // Model forecast line: COPPER (model intelligence) by default, RED only when the
  // selected scope (mine or portfolio) has a risk-flagged week — the banner
  // verdict and the line then agree.
  const predictedAtRisk = selected
    ? selected.forecast.some((f) => f.status === "risk")
    : data.mines.some((m) => m.forecast.some((f) => f.status === "risk"));
  const predictedColor = predictedAtRisk ? "var(--chart-risk)" : "var(--chart-copper)";

  // Build chart series: last N weeks history + 4 forecast weeks (single chart)
  const { chartData, forecastStartIdx } = useMemo(() => {
    const history = selected
      ? selected.weekly.slice(-weeksShown).map((w) => ({
          label: fmtDate(w.weekStart),
          actual: w.actual,
          fitted: w.fitted,
          target: w.target,
          predicted: null as number | null,
          rainfall: w.rainfall,
        }))
      : (() => {
          // aggregate all mines by week
          const byWeek = new Map<string, { actual: number; fitted: number; target: number; rainfall: number }>();
          for (const m of data.mines) {
            for (const w of m.weekly.slice(-weeksShown)) {
              const e = byWeek.get(w.weekStart) ?? { actual: 0, fitted: 0, target: 0, rainfall: 0 };
              e.actual += w.actual;
              e.fitted += w.fitted ?? 0;
              e.target += w.target;
              e.rainfall += w.rainfall;
              byWeek.set(w.weekStart, e);
            }
          }
          return [...byWeek.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([weekStart, v]) => ({
              label: fmtDate(weekStart),
              actual: Math.round(v.actual),
              fitted: Math.round(v.fitted),
              target: Math.round(v.target),
              predicted: null as number | null,
              rainfall: Math.round(v.rainfall),
            }));
        })();

    const forecasts = selected
      ? selected.forecast
      : (() => {
          const byWeek = new Map<string, { predicted: number; target: number; p10: number; p90: number }>();
          for (const m of data.mines) {
            for (const f of m.forecast) {
              const e = byWeek.get(f.weekStart) ?? { predicted: 0, target: 0, p10: 0, p90: 0 };
              e.predicted += f.predicted;
              e.target += f.target;
              e.p10 += f.p10 ?? f.predicted;
              e.p90 += f.p90 ?? f.predicted;
              byWeek.set(f.weekStart, e);
            }
          }
          return [...byWeek.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([weekStart, v], i) => ({
              weekStart,
              horizon: i + 1,
              predicted: Math.round(v.predicted),
              target: Math.round(v.target),
              confidence: 0.88,
              status: v.predicted < v.target * 0.93 ? "risk" : v.predicted < v.target * 0.985 ? "watch" : "ok",
              shortfall: Math.round(v.predicted - v.target),
              factors: [],
              p10: Math.round(v.p10),
              p90: Math.round(v.p90),
            })) as ForecastPoint[];
        })();

    const fcRows = forecasts.map((f) => ({
      label: fmtDate(f.weekStart),
      actual: null as number | null,
      fitted: null as number | null,
      target: f.target,
      predicted: f.predicted,
      rainfall: null as number | null,
      p10: f.p10 ?? null,
      p90: f.p90 ?? null,
    }));
    const histRows = history.map((h) => ({ ...h, p10: null as number | null, p90: null as number | null }));
    return {
      chartData: [...histRows, ...fcRows],
      forecastStartIdx: histRows.length,
    };
  }, [selected, data.mines, weeksShown]);

  // Forecast table rows + worst forecast for explainability
  type ForecastRow = ForecastPoint & { mineCode?: string; mineName?: string };
  const forecastRows: ForecastRow[] = selected
    ? selected.forecast
    : data.mines
        .flatMap((m) => m.forecast.map((f) => ({ ...f, mineCode: m.code, mineName: m.name })))
        .sort((a, b) => a.shortfall - b.shortfall)
        .slice(0, 8);

  const worstForecast: ForecastRow | undefined = selected
    ? [...selected.forecast].sort((a, b) => a.shortfall - b.shortfall)[0]
    : data.mines
        .flatMap((m) => m.forecast.map((f) => ({ ...f, mineCode: m.code, mineName: m.name })))
        .sort((a, b) => a.shortfall - b.shortfall)[0];

  const forecastLabel = chartData[forecastStartIdx]?.label;
  const lastLabel = chartData[chartData.length - 1]?.label;

  return (
    <div className="space-y-6">
      {/* Verified public record (cited) + calibration vs digital twin */}
      <VerifiedRecordPanel />

      {/* Data provenance banner */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3">
        <Badge className="border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          REAL WEATHER
        </Badge>
        <span className="text-xs text-muted-foreground">ERA5 rainfall &amp; soil moisture</span>
        <Badge className="ml-2 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          SIMULATED OPS · CALIBRATED
        </Badge>
        <span className="text-xs text-muted-foreground">
          Weekly mine-level ops are a digital twin — calibrated to MOIL&apos;s verified FY26 total (see
          public record above), not recorded granular operations
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="mine-select" className="text-xs text-muted-foreground">
            Mine
          </Label>
          <Select value={mineFilter} onValueChange={setMineFilter}>
            <SelectTrigger id="mine-select" className="w-56">
              <SelectValue placeholder="Select mine" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All mines — portfolio total</SelectItem>
              {data.mines.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Time range</Label>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="rain-toggle" checked={showRain} onCheckedChange={setShowRain} />
          <Label htmlFor="rain-toggle" className="text-xs text-muted-foreground">
            Rainfall overlay (right axis · real ERA5)
          </Label>
        </div>{selected && (
          <Badge variant="outline" className="text-muted-foreground">
            Last-12-week achievement: {selected.last12AchievementPct}%
          </Badge>
        )}
      </div>

      {/* ---------- Decision banner: will this mine miss target? ---------- */}
      {(() => {
        const scope = selected ? selected.name : "Portfolio (10 mines)";
        const weeks = selected ? selected.forecast : [];
        const riskWeeks = weeks.filter((f) => f.status === "risk");
        const watchWeeks = weeks.filter((f) => f.status === "watch");
        const portfolioAtRisk = data.mines.filter((m) =>
          m.forecast.some((f) => f.status === "risk"),
        ).length;
        const verdict = selected
          ? riskWeeks.length > 0
            ? "AT RISK"
            : watchWeeks.length > 0
              ? "WATCH"
              : "ON TRACK"
          : `${portfolioAtRisk} MINES AT RISK`;
        // Dominant operational driver (exclude the plan baseline — it is the
        // reference, not a risk lever)
        const domFac = worstForecast
          ? [...worstForecast.factors]
              .filter((f) => f.name !== "Planned target")
              .sort((a, b) => a.contribution - b.contribution)[0]
          : undefined;
        return (
          <div
            role="status"
            aria-label="Forecast verdict"
            className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border p-3.5 ${
              verdict.endsWith("AT RISK")
                ? "border-red-500/40 bg-red-500/5"
                : verdict === "WATCH"
                  ? "border-yellow-500/40 bg-yellow-500/5"
                  : "border-green-600/40 bg-green-500/5"
            }`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Will {scope} miss target in the next 4 weeks?
            </p>
            <p
              className={`text-lg font-bold tabular-nums ${
                verdict.endsWith("AT RISK")
                  ? "text-red-600 dark:text-red-400"
                  : verdict === "WATCH"
                    ? "text-yellow-700 dark:text-yellow-500"
                    : "text-green-700 dark:text-green-400"
              }`}
            >
              {verdict}
            </p>
            {selected ? (
              <p className="text-xs text-muted-foreground">
                {riskWeeks.length + watchWeeks.length > 0
                  ? `${riskWeeks.length} risk + ${watchWeeks.length} watch of 4 weeks`
                  : "all 4 weeks within tolerance"}
                {worstForecast && worstForecast.shortfall < 0 && (
                  <>
                    {" · worst gap "}
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      −{fmtT(Math.abs(worstForecast.shortfall))} t
                    </span>
                    {" (wk of " + fmtDate(worstForecast.weekStart) + ")"}
                  </>
                )}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                per-mine verdicts via the mine selector · worst portfolio gap{" "}
                {worstForecast && worstForecast.shortfall < 0 && (
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    −{fmtT(Math.abs(worstForecast.shortfall))} t ({worstForecast.mineCode})
                  </span>
                )}
              </p>
            )}
            {domFac && domFac.contribution < 0 && (
              <p className="ml-auto text-xs text-muted-foreground">
                Dominant driver:{" "}
                <span className="font-semibold text-red-600 dark:text-red-400">
                  {domFac.name} (−{fmtT(Math.abs(domFac.contribution))} t)
                </span>
                {worstForecast?.mineCode ? ` · ${worstForecast.mineCode}` : ""}
              </p>
            )}
          </div>
        );
      })()}

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {selected ? `${selected.name} — weekly production` : "Portfolio weekly production"}
          </CardTitle>
          <CardDescription>
            Actual vs plan target vs model fit (dashed = held-out fit on last 12 weeks). Shaded
            area marks the 4-week-ahead forecast; the forecast line turns red when a shortfall
            is predicted. Copper band = P10–P90 quantile risk interval (80% of held-out weeks
            fell inside this band).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--chart-axis)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--chart-grid)" }}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <YAxis
                  yAxisId="t"
                  tick={{ fontSize: 10, fill: "var(--chart-axis)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                {showRain && (
                  <YAxis
                    yAxisId="rain"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "var(--chart-rain)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}mm`}
                  />
                )}
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {forecastLabel && (
                  <ReferenceArea
                    yAxisId="t"
                    x1={forecastLabel}
                    x2={lastLabel}
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
                {showRain && (
                  <Bar
                    yAxisId="rain"
                    dataKey="rainfall"
                    name="Rainfall (real ERA5)"
                    fill="var(--chart-rain)"
                    fillOpacity={0.25}
                    radius={[2, 2, 0, 0]}
                  />
                )}
                <Line
                  yAxisId="t"
                  dataKey="actual"
                  name="Actual"
                  stroke="var(--chart-ink)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="t"
                  dataKey="target"
                  name="Plan target"
                  stroke="var(--chart-plan)"
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                  dot={false}
                />
                <Line
                  yAxisId="t"
                  dataKey="fitted"
                  name="Model fit"
                  stroke="var(--chart-copper)"
                  strokeOpacity={0.55}
                  strokeWidth={1.25}
                  strokeDasharray="5 5"
                  dot={false}
                />
                {/* P10/P90 risk band — fill between p90 (top) and p10 (bottom) */}
                <Area
                  yAxisId="t"
                  dataKey="p90"
                  name="P90 (upside)"
                  stroke="none"
                  fill="var(--chart-copper)"
                  fillOpacity={0.18}
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="none"
                />
                <Area
                  yAxisId="t"
                  dataKey="p10"
                  name="P10–P90 band (80% risk interval)"
                  stroke="none"
                  fill="var(--background)"
                  fillOpacity={1}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="t"
                  dataKey="predicted"
                  name="Predicted (4-wk)"
                  stroke={predictedColor}
                  strokeWidth={2.5}
                  strokeDasharray="6 3"
                  dot={{ r: 3, fill: predictedColor }}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Forecast table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">4-week shortfall forecast</CardTitle>
            <CardDescription>
              {selected
                ? `Next 4 weeks for ${selected.name}`
                : "Most severe forecasts across all mines (top 8)"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead className="text-right">Predicted</TableHead>
                  <TableHead className="text-right">P10–P90</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecastRows.map((f) => (
                  <TableRow key={`${f.weekStart}-${f.horizon}-${f.mineCode ?? "total"}`}>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {fmtDate(f.weekStart)}
                      {f.mineCode && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{f.mineCode}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtT(f.predicted)} t</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {f.p10 != null && f.p90 != null ? `${fmtT(f.p10)}–${fmtT(f.p90)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtT(f.target)} t
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-semibold ${f.shortfall < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                    >
                      {f.shortfall < 0 ? "−" : "+"}
                      {fmtT(Math.abs(f.shortfall))} t
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={f.status} />
                    </TableCell>
                    <TableCell>
                      <ConfidenceMeter value={f.confidence} label="" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Explainability */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base">Prediction explainability</CardTitle>
            </div>
            <CardDescription>
              {worstForecast
                ? `Why ${worstForecast.mineName ?? "this mine"} is predicted at ${fmtT(worstForecast.predicted)} t for the week of ${fmtDate(worstForecast.weekStart)}`
                : "No forecast available"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {worstForecast && worstForecast.factors.length > 0 ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={worstForecast.status} />
                  <span className="text-sm tabular-nums">
                    predicted <span className="font-semibold">{fmtT(worstForecast.predicted)} t</span>
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    target {fmtT(worstForecast.target)} t
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
                    −{fmtT(Math.abs(worstForecast.shortfall))} t
                  </span>
                </div>
                <FactorBars factors={worstForecast.factors} />
                <p className="rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  Factors are coefficient-based contributions in tonnes (exact linear-SHAP for a
                  linear model: φ = w·(x−μ)/σ) — they sum to the deviation from average weekly
                  output. Negative bars (red) push production down; each is the actionable lever
                  for the recommendation engine. Validation: rolling-origin 3 folds × 52 weeks
                  (no future leakage) · weather REAL ERA5 · ops synthetic (labeled).
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select an individual mine to see full factor attribution for its worst forecast
                week.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Scenario Lab (what-if planning) ---------- */}
      <ScenarioLab mineId={selected?.id ?? null} />
    </div>
  );
}
