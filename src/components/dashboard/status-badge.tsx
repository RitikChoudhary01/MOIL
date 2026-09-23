import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; cls: string; dot: string }> = {
  ok: {
    label: "OK",
    cls: "border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/50 dark:text-green-400",
    dot: "bg-green-500",
  },
  watch: {
    label: "WATCH",
    cls: "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/60 dark:bg-yellow-950/50 dark:text-yellow-500",
    dot: "bg-yellow-500",
  },
  risk: {
    label: "RISK",
    cls: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-400",
    dot: "bg-red-500",
  },
};

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

/** ok = green, watch = yellow, risk = red, with dot indicator. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const s = STYLES[status] ?? STYLES.ok;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        s.cls,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden="true" />
      {label ?? s.label}
    </span>
  );
}
