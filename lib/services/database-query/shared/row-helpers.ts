// ---------------------------------------------------------------------------
// Database Query — Row Helpers
// ---------------------------------------------------------------------------
// Small cross-domain row utilities. Used by count/distribution/session/theme
// handlers and by drill-down theme bucketing.
// ---------------------------------------------------------------------------

/**
 * Casts a joined client row to extract the name.
 * Supabase returns joined rows as { name: string } | null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join types are loosely typed
export function extractClientName(row: any): string {
  const clientData = row.clients as { name: string } | null;
  return clientData?.name ?? "Unknown";
}

/**
 * Extracts a string field from each row's `structured_json` column and
 * aggregates into a distribution map. Used by sentiment and urgency handlers.
 */
export function aggregateJsonField(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase rows are loosely typed
  rows: any[],
  field: string,
  buckets: Record<string, number>
): Record<string, number> {
  const distribution = { ...buckets };
  for (const row of rows) {
    const json = row.structured_json as Record<string, unknown> | null;
    const value = json?.[field] as string | undefined;
    if (value && value in distribution) {
      distribution[value]++;
    }
  }
  return distribution;
}

/**
 * Truncates a date to the start of its week (Monday) or month.
 * Returns an ISO date string (YYYY-MM-DD).
 */
export function dateTrunc(granularity: "week" | "month", date: Date): string {
  if (granularity === "month") {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  }
  // Week: truncate to Monday
  const day = date.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - diff);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
