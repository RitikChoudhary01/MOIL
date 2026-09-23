// Number / date formatting helpers — Indian locale throughout (judge-facing).

const nf = new Intl.NumberFormat("en-IN");
const nf1 = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const nf2 = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/** Indian-grouping integer: 74810 → "74,810" */
export function fmt(n: number): string {
  return nf.format(Math.round(n));
}

/** One decimal, Indian grouping: 250.46 → "250.5" */
export function fmt1(n: number): string {
  return nf1.format(n);
}

/** Two decimals, Indian grouping */
export function fmt2(n: number): string {
  return nf2.format(n);
}

/** Signed tonnes: -318 → "−318 t", +176 → "+176 t" (true minus sign U+2212) */
export function fmtSignedT(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${nf.format(Math.abs(Math.round(n)))} t`;
}

/** Signed bare number: -33.4 → "−33.4%" */
export function fmtSignedPct(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${nf1.format(Math.abs(n))}%`;
}

/** Compact axis tick: 74810 → "75K", 105766 → "1.06L" */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 100000) return `${nf1.format(n / 100000)}L`;
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}K`;
  return nf.format(n);
}

/** Sensible factor value: 965.95 → "966", 11.07 → "11.1", 0.6 → "0.6" */
export function fmtFactorValue(v: number): string {
  if (Math.abs(v) >= 100) return nf.format(Math.round(v));
  if (Math.abs(v) >= 10) return nf1.format(v);
  return String(Math.round(v * 10) / 10);
}

/** Parse "YYYY-MM-DD" (or full ISO) as LOCAL date — avoids TZ off-by-one. */
export function parseDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "2026-08-31" → "31 Aug" */
export function fmtWeek(s: string): string {
  return parseDay(s).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/** "2026-08-31" → "31 Aug 2026" */
export function fmtWeekFull(s: string): string {
  return parseDay(s).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "Aug 2025" → "Aug 25" (axis label) */
export function shortMonth(month: string): string {
  const [m, y] = month.split(" ");
  return `${m} ${y.slice(-2)}`;
}

/** Hex color lerp for map pin heat scale. */
export function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
