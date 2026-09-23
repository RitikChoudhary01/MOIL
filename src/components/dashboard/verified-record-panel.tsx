"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ExternalLink, Landmark, Scale } from "lucide-react";
import { useApi } from "@/components/dashboard/use-api";

interface PublicFigure {
  period: string;
  periodType: "annual" | "quarter" | "month" | "cumulative";
  label: string;
  tonnes: number;
  yoyGrowthPct?: number;
  note?: string;
  derived?: boolean;
  source: string;
  sourceUrl?: string;
  publishedOn: string;
}

interface PublicDataPayload {
  figures: PublicFigure[];
  context: { fact: string; source: string; sourceUrl?: string }[];
  calibration: {
    anchor: string;
    verifiedTonnes: number;
    simulatedTonnes: number;
    gapPct: number;
    plannerOptimismPct: number;
    nameplateCapacityTonnes: number;
    note: string;
  };
  disclaimer: string;
}

const LAKH = 100_000;
const TYPE_COLOR: Record<PublicFigure["periodType"], string> = {
  annual: "#059669",
  quarter: "#0d9488",
  cumulative: "#0891b2",
  month: "#65a30d",
};

function PanelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PublicFigure }[];
}) {
  if (!active || !payload?.length) return null;
  const f = payload[0].payload;
  return (
    <div className="max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{f.label}</p>
      <p className="mt-0.5">
        {(f.tonnes / LAKH).toFixed(2)} lakh tonnes
        {f.yoyGrowthPct != null && (
          <span className="text-muted-foreground"> · {f.yoyGrowthPct > 0 ? "+" : ""}{f.yoyGrowthPct}% YoY</span>
        )}
      </p>
      {f.note && <p className="mt-1 text-muted-foreground">{f.note}</p>}
      <p className="mt-1 text-muted-foreground">
        Source: {f.source} · {f.publishedOn}
      </p>
    </div>
  );
}

export function VerifiedRecordPanel() {
  const { data, loading, error } = useApi<PublicDataPayload>("/api/public-data");

  const chartRows = useMemo(() => {
    if (!data) return [];
    // Chronological order for the story: FY24 → FY26 records, then FY26 quarters/months
    const order = [
      "FY2023-24",
      "FY2024-25",
      "FY2025-26",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-04_2025-08",
      "2025-10",
      "2025-11",
      "FY2025-26-Q3",
      "FY2022-23-Q4",
      "FY2026-27-Q1",
    ];
    return [...data.figures]
      .sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period))
      .map((f) => ({ ...f, lakh: Number((f.tonnes / LAKH).toFixed(2)) }));
  }, [data]);

  const cal = data?.calibration;
  const calGood = cal != null && Math.abs(cal.gapPct) < 3;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-emerald-600" aria-hidden />
            Verified Public Record — MOIL Limited
          </CardTitle>
          <Badge className="border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            REAL · CITED
          </Badge>
          <span className="text-xs text-muted-foreground">
            Government of India PIB releases, PTI &amp; company statements — every figure traceable
          </span>
        </div>
        <CardDescription>
          Company-wide manganese ore production as reported publicly. This is the ground truth the
          digital-twin simulation below is calibrated against — no simulated number is presented as
          a recorded fact.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="h-56 animate-pulse rounded-lg bg-muted/50" aria-label="Loading verified record" />
        )}
        {error && (
          <p className="text-xs text-red-600">Verified-record feed unavailable: {error}</p>
        )}

        {data && (
          <>
            {/* Chart */}
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 8, right: 8, left: -12, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    angle={-32}
                    textAnchor="end"
                    height={58}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    label={{
                      value: "lakh tonnes",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10 },
                    }}
                  />
                  <Tooltip content={<PanelTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Bar dataKey="lakh" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {chartRows.map((row) => (
                      <Cell key={row.period} fill={TYPE_COLOR[row.periodType]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {(
                [
                  ["annual", "Annual"],
                  ["quarter", "Quarterly"],
                  ["cumulative", "Multi-month"],
                  ["month", "Monthly"],
                ] as [PublicFigure["periodType"], string][]
              ).map(([t, lbl]) => (
                <span key={t} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TYPE_COLOR[t] }} />
                  {lbl}
                </span>
              ))}
            </div>

            {/* Calibration vs digital twin */}
            {cal && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Scale className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="text-sm font-medium">Digital-twin calibration</span>
                  <Badge
                    className={
                      calGood
                        ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    }
                  >
                    {cal.gapPct > 0 ? "+" : ""}
                    {cal.gapPct}% vs verified
                  </Badge>
                  <Badge variant="outline" className="text-[11px]">
                    planner optimism +{cal.plannerOptimismPct}%
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Simulated FY2025-26 portfolio total:{" "}
                  <strong>{(cal.simulatedTonnes / LAKH).toFixed(2)} lakh t</strong> · verified public
                  total: <strong>{(cal.verifiedTonnes / LAKH).toFixed(2)} lakh t</strong> · nameplate
                  capacity: {(cal.nameplateCapacityTonnes / LAKH).toFixed(2)} lakh t/yr.{" "}
                  {cal.note}
                </p>
              </div>
            )}

            {/* Citations */}
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-xs font-medium hover:bg-muted/40">
                <span>Sources &amp; citations ({data.figures.length} figures · click to expand)</span>
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-2 space-y-2">
                  {data.figures.map((f) => (
                    <li key={f.period} className="rounded-md border p-2.5 text-xs">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="font-medium">
                          {f.label} — {(f.tonnes / LAKH).toFixed(2)} lakh t
                          {f.yoyGrowthPct != null && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({f.yoyGrowthPct > 0 ? "+" : ""}
                              {f.yoyGrowthPct}% YoY)
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground">published {f.publishedOn}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                        <span>{f.source}</span>
                        {f.sourceUrl && (
                          <a
                            href={f.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400"
                          >
                            link <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                  {data.context.map((c, i) => (
                    <li key={`ctx-${i}`} className="rounded-md border border-dashed p-2.5 text-xs">
                      <span>{c.fact}</span>
                      <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                        <span>{c.source}</span>
                        {c.sourceUrl && (
                          <a
                            href={c.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400"
                          >
                            link <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>

            <p className="text-[11px] text-muted-foreground">{data.disclaimer}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
