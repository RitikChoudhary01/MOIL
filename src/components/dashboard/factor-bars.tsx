import { cn } from "@/lib/utils";
import { fmtFactorValue, fmt, fmt2 } from "./format";
import type { Factor, WeightFeature } from "./types";

export interface FactorBarsProps {
  factors: (Factor | WeightFeature)[];
  /** suffix on the right-hand contribution value — " t" default, "" for model weights */
  unitSuffix?: string;
  /** plain format for unitless coefficients (model weights) */
  plain?: boolean;
  compact?: boolean;
  /** render only the first N rows (after sorting) */
  maxRows?: number;
  className?: string;
}

function contributionOf(f: Factor | WeightFeature): number {
  return "contribution" in f ? f.contribution : f.weight;
}

function valueOf(f: Factor | WeightFeature): number | undefined {
  return "value" in f ? f.value : undefined;
}

/**
 * Diverging horizontal contribution bars (SHAP-style).
 * Negative (production-hurting) = red extending LEFT from centre;
 * positive (helping) = emerald extending RIGHT.
 * Rows sorted most-negative-first — the biggest hurting driver leads.
 */
export function FactorBars({
  factors,
  unitSuffix = " t",
  plain = false,
  compact = false,
  maxRows,
  className,
}: FactorBarsProps) {
  const rows = [...factors]
    .sort((a, b) => contributionOf(a) - contributionOf(b))
    .slice(0, maxRows ?? factors.length);
  const max = Math.max(1e-9, ...rows.map((f) => Math.abs(contributionOf(f))));

  const fmtContribution = (n: number) =>
    plain
      ? `${n < 0 ? "−" : "+"}${fmt2(Math.abs(n))}`
      : `${n < 0 ? "−" : "+"}${fmt(Math.abs(Math.round(n)))}${unitSuffix}`;

  return (
    <div className={cn("space-y-1.5", className)} role="list" aria-label="Factor contributions">
      {rows.map((f, i) => {
        const c = contributionOf(f);
        const neg = c < 0;
        // half-track percentage, with a small floor so slivers stay visible
        const w = Math.max(0.9, (Math.abs(c) / max) * 50);
        const v = valueOf(f);
        return (
          <div
            key={`${f.name}-${i}`}
            role="listitem"
            className={cn(
              "grid items-center gap-2",
              compact
                ? "grid-cols-[minmax(0,7.5rem)_1fr_3.25rem] sm:grid-cols-[minmax(0,11rem)_1fr_4rem]"
                : "grid-cols-[minmax(0,8.5rem)_1fr_3.75rem] sm:grid-cols-[minmax(0,13rem)_1fr_4.5rem]"
            )}
          >
            <span
              className={cn(
                "truncate text-muted-foreground",
                compact ? "text-[11px]" : "text-xs"
              )}
              title={
                v !== undefined ? `${f.name} · ${fmtFactorValue(v)} ${"unit" in f ? f.unit ?? "" : ""}` : f.name
              }
            >
              {f.name}
              {v !== undefined && (
                <span className="text-muted-foreground/70">
                  {" "}
                  · {fmtFactorValue(v)}
                  {"unit" in f && f.unit ? ` ${f.unit}` : ""}
                </span>
              )}
            </span>
            <div
              className={cn(
                "relative w-full rounded bg-muted/60 dark:bg-muted/40",
                compact ? "h-2.5" : "h-3.5"
              )}
              aria-hidden="true"
            >
              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <span
                className={cn(
                  "absolute inset-y-[2px] rounded-[2px] transition-[width] duration-500",
                  neg ? "right-1/2 bg-red-500" : "left-1/2 bg-green-500"
                )}
                style={{ width: `${w}%` }}
              />
            </div>
            <span
              className={cn(
                "text-right font-medium tabular-nums",
                compact ? "text-[11px]" : "text-xs",
                neg ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
              )}
            >
              {fmtContribution(c)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
