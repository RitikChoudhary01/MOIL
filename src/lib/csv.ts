// ============================================================
// CSV serialization — RFC 4180 compliant (quotes, commas,
// newlines escaped; header injected once). Pure + testable.
// ============================================================

/** Escape a single CSV field per RFC 4180. */
export function csvField(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialize rows (array of records) to CSV with a stable column union. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return columns ? columns.map(csvField).join(",") + "\n" : "";
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(csvField).join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => csvField(r[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Content-Disposition attachment header with a safe filename. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
    "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
  };
}
