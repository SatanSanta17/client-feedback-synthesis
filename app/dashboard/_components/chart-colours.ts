// ---------------------------------------------------------------------------
// Shared chart colour constants for dashboard widgets.
// Hardcoded hex values because Recharts requires concrete colour strings.
// ---------------------------------------------------------------------------

/** Brand primary colour — indigo-500. */
export const BRAND_PRIMARY_HEX = "#6366f1";
/** Brand primary in RGB triplet — for rgba() opacity mapping. */
export const BRAND_PRIMARY_RGB = "99, 102, 241";
/** Foreground colour for chart cells with high background opacity.
 *  White ensures readable contrast against brand-primary fills at opacity > 0.5. */
export const CHART_HIGH_CONTRAST_TEXT_HEX = "#ffffff";

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

// ---------------------------------------------------------------------------
// Chunk type labels — human-readable display names for signal chunk types.
// ---------------------------------------------------------------------------

export const CHUNK_TYPE_LABELS: Record<string, string> = {
  pain_point: "Pain Point",
  requirement: "Requirement",
  blocker: "Blocker",
  aspiration: "Aspiration",
  competitive_mention: "Competitive Mention",
  tool_and_platform: "Tool & Platform",
  client_profile: "Client Profile",
  summary: "Summary",
  praise: "Praise",
  question: "Question",
  action_item: "Action Item",
  custom: "Custom",
  raw: "Raw",
};

/**
 * Returns a human-readable label for a chunk type key.
 * Falls back to replacing underscores with spaces.
 */
export function formatChunkType(key: string): string {
  return CHUNK_TYPE_LABELS[key] ?? key.replace(/_/g, " ");
}

/**
 * Returns a pluralised human-readable label for a chunk type key.
 * Used in tooltip breakdowns.
 */
export function formatChunkTypePlural(key: string): string {
  const PLURAL_LABELS: Record<string, string> = {
    pain_point: "Pain points",
    requirement: "Requirements",
    blocker: "Blockers",
    aspiration: "Aspirations",
    competitive_mention: "Competitive mentions",
    tool_and_platform: "Tools & platforms",
    client_profile: "Client profiles",
    summary: "Summaries",
    praise: "Praises",
    question: "Questions",
    action_item: "Action items",
    custom: "Custom",
    raw: "Raw",
  };
  return PLURAL_LABELS[key] ?? key.replace(/_/g, " ");
}

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
