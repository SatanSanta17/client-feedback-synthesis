// ---------------------------------------------------------------------------
// Database Query — Types
// ---------------------------------------------------------------------------
// Public type surface for the database-query module. Lifted out of the
// monolith in PRD-023 P5 Increment 1 so domain modules can import without
// pulling in the entry-point.
// ---------------------------------------------------------------------------

export type QueryAction =
  | "count_clients"
  | "count_sessions"
  | "sessions_per_client"
  | "sentiment_distribution"
  | "urgency_distribution"
  | "recent_sessions"
  | "client_list"
  // Dashboard actions (PRD-021 Part 2)
  | "sessions_over_time"
  | "client_health_grid"
  | "competitive_mention_frequency"
  // Theme widget actions (PRD-021 Part 3)
  | "top_themes"
  | "theme_trends"
  | "theme_client_matrix"
  // Drill-down actions (PRD-021 Part 4)
  | "drill_down"
  | "session_detail"
  // Insight actions (PRD-021 Part 5)
  | "insights_latest"
  | "insights_history";

export interface QueryFilters {
  teamId: string | null;
  dateFrom?: string;
  dateTo?: string;
  clientName?: string;
  // Dashboard filters (PRD-021 Part 2)
  clientIds?: string[];
  severity?: string;
  urgency?: string;
  granularity?: "week" | "month";
  // Theme widget filters (PRD-021 Part 3)
  confidenceMin?: number;
  // Drill-down filters (PRD-021 Part 4)
  drillDown?: string;
  sessionId?: string;
}

export interface DatabaseQueryResult {
  action: QueryAction;
  data: Record<string, unknown>;
}

export interface ActionMeta {
  llmToolExposed: boolean;
  description: string;
}

/**
 * Canonical row shape returned by every drill-down strategy. Defined here so
 * the drill-down router and its strategy modules share one type without a
 * circular import. `themeName` is null for non-theme drill-downs.
 */
export interface DrillDownRow {
  embeddingId: string;
  sessionId: string;
  sessionDate: string;
  chunkText: string;
  chunkType: string;
  themeName: string | null;
  metadata: Record<string, unknown>;
  clientId: string;
  clientName: string;
}
