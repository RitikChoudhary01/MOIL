"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Factor } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

// ---------------- KPI Card ----------------

export function KpiCard({
  title,
  value,
  unit,
  subtext,
  subtextTone = "neutral",
  icon: Icon,
}: {
  title: string;
  value: string;
  unit?: string;
  subtext?: string;
  subtextTone?: "neutral" | "positive" | "negative" | "warning";
  icon: LucideIcon;
}) {
  const toneClass =
    subtextTone === "positive"
      ? "text-green-600 dark:text-green-400"
      : subtextTone === "negative"
        ? "text-red-600 dark:text-red-400"
        : subtextTone === "warning"
          ? "text-yellow-600 dark:text-yellow-500"
          : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        </div>
        <p className="mt-2.5 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
          {unit && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
          )}
        </p>
        {subtext && <p className={cn("mt-1.5 text-xs tabular-nums", toneClass)}>{subtext}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------- Status Badge ----------------

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    risk: {
      label: "Risk",
      className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-900",
    },
    watch: {
      label: "Watch",
      className: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-500 dark:border-yellow-900",
    },
    ok: {
      label: "On track",
      className: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-900",
    },
  };
  const cfg = map[status] ?? map.ok;
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", cfg.className)}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "risk"
            ? "bg-red-500"
            : status === "watch"
              ? "bg-yellow-500"
              : "bg-green-500",
        )}
        aria-hidden="true"
      />
      {cfg.label}
    </Badge>
  );
}

export function MineTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {type === "open-pit" ? "Open-pit" : "Underground"}
    </Badge>
  );
}

// ---------------- Diverging factor bars (coefficient-based contributions,
// exact linear-SHAP for the linear model — φ = w·(x−μ)/σ) ----------------

export function FactorBars({
  factors,
  compact = false,
  maxRows,
}: {
  factors: Factor[];
  compact?: boolean;
  maxRows?: number;
}) {
  const sorted = [...factors].sort((a, b) => a.contribution - b.contribution);
  const shown = maxRows ? sorted.slice(0, maxRows) : sorted;
  const maxAbs = Math.max(...shown.map((f) => Math.abs(f.contribution)), 1);
  return (
    <div className={cn("space-y-1.5", compact && "space-y-1")}>
      {shown.map((f) => {
        const pct = (Math.abs(f.contribution) / maxAbs) * 100;
        const negative = f.contribution < 0;
        return (
          <div key={f.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  "truncate",
                  compact ? "text-[11px]" : "text-xs",
                  "text-muted-foreground",
                )}
                title={`${f.name} = ${f.value} ${f.unit}`}
              >
                {f.name}
                {!compact && (
                  <span className="ml-1 tabular-nums text-muted-foreground/70">
                    {f.value}
                    {f.unit === "flag" ? "" : ` ${f.unit}`}
                  </span>
                )}
              </span>
            </div>
            <span
              className={cn(
                "tabular-nums text-right font-medium",
                compact ? "text-[11px]" : "text-xs",
                negative ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400",
              )}
            >
              {negative ? "−" : "+"}
              {Math.abs(Math.round(f.contribution)).toLocaleString("en-IN")} t
            </span>
            <div className="col-span-2 relative h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 rounded-full",
                  negative
                    ? "right-0 bg-red-500/80"
                    : "right-0 bg-green-500/80",
                )}
                style={{ width: `${pct}%` }}
                role="img"
                aria-label={`${f.name}: ${f.contribution > 0 ? "+" : "−"}${Math.abs(f.contribution)} tonnes contribution`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Confidence meter ----------------

export function ConfidenceMeter({
  value,
  label = "Confidence",
}: {
  value: number;
  label?: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-muted-foreground/60"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {label} {pct}%
      </span>
    </div>
  );
}

// ---------------- Skeletons ----------------

export function TabSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Retry
          </button>
        )}
      </CardContent>
    </Card>
  );
}
