// ---------------------------------------------------------------------------
// Shared chart colour constants for dashboard widgets.
// Hardcoded hex values because Recharts requires concrete colour strings.
// ---------------------------------------------------------------------------

/** Brand primary colour — indigo-500. */
export const BRAND_PRIMARY_HEX = "#6366f1";
/** Brand primary in RGB triplet — for rgba() opacity mapping. */
export const BRAND_PRIMARY_RGB = "99, 102, 241";

export const SENTIMENT_COLOURS: Record<string, string> = {
  positive: "#22c55e", // green-500
  neutral: "#94a3b8",  // slate-400
  negative: "#ef4444", // red-500
  mixed: "#f59e0b",    // amber-500
};

export const URGENCY_COLOURS: Record<string, string> = {
  low: "#22c55e",      // green-500
  medium: "#f59e0b",   // amber-500
  high: "#f97316",     // orange-500
  critical: "#ef4444", // red-500
};

/**
 * 8-colour palette for multi-line theme charts. Colours cycle when
 * more than 8 themes are selected.
 */
export const THEME_LINE_COLOURS: string[] = [
  "#6366f1", // indigo-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ef4444", // red-500
  "#06b6d4", // cyan-500
  "#84cc16", // lime-500
];
