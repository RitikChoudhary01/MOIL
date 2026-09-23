import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fmt } from "./format";

interface ConfidenceMeterProps {
  value: number; // 0..1
  label?: string;
  className?: string;
}

/** Thin blue progress bar with a % label. */
export function ConfidenceMeter({ value, label = "Confidence", className }: ConfidenceMeterProps) {
  const pct = Math.round(value * 100);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label !== "" && <span className="text-[11px] whitespace-nowrap text-muted-foreground">{label}</span>}
      <Progress
        value={pct}
        aria-label={`${label} ${pct} percent`}
        className="h-1.5 w-16 bg-muted [&>div]:bg-yellow-600"
      />
      <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{fmt(pct)}%</span>
    </div>
  );
}
