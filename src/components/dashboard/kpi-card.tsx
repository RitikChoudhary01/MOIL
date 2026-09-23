import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  unit?: string;
  subtext: React.ReactNode;
  subtextTone?: "positive" | "negative" | "warning" | "neutral";
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  /** extra classes for the big value line (e.g. text-red-600) */
  valueClassName?: string;
  /** CSS animation delay in ms for staggered entrance */
  animationDelay?: number;
}

const SUBTEXT_TONE: Record<string, string> = {
  positive: "text-green-600 dark:text-green-400",
  negative: "text-red-600 dark:text-red-400",
  warning: "text-yellow-600 dark:text-yellow-400",
  neutral: "text-muted-foreground",
};

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

const TREND_COLOR = {
  up: "text-green-600 dark:text-green-400",
  down: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
};

const ICON_BG = {
  up: "bg-green-500/10 text-green-700 dark:text-green-400",
  down: "bg-red-500/10 text-red-700 dark:text-red-400",
  neutral: "bg-amber-500/10 text-amber-700 dark:text-amber-500",
};

export function KpiCard({
  title,
  value,
  unit,
  subtext,
  subtextTone = "neutral",
  icon: Icon,
  trend = "neutral",
  valueClassName,
  animationDelay = 0,
}: KpiCardProps) {
  const TrendIcon = TREND_ICON[trend];
  return (
    <Card
      className="relative gap-0 overflow-hidden rounded-xl p-5 py-4 transition-all duration-200 hover:border-amber-500/40 hover:shadow-lg rise-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Accent bar */}
      <div
        className={cn(
          "absolute left-0 top-0 h-[3px] w-full",
          trend === "up"
            ? "bg-green-500/60"
            : trend === "down"
              ? "bg-red-500/60"
              : "bg-amber-500/40"
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
        <span className={cn("rounded-md p-1.5", ICON_BG[trend])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums tracking-tight",
            valueClassName
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-sm text-muted-foreground">{unit}</span>
        )}
        {trend !== "neutral" && (
          <TrendIcon
            className={cn("h-4 w-4 shrink-0", TREND_COLOR[trend])}
            aria-hidden="true"
          />
        )}
      </div>
      <div className={cn("mt-1.5 text-xs leading-relaxed tabular-nums", SUBTEXT_TONE[subtextTone])}>
        {subtext}
      </div>
    </Card>
  );
}
