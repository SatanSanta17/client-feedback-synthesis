// ---------------------------------------------------------------------------
// Drill-Down Types (PRD-021 Part 4)
// ---------------------------------------------------------------------------
// Discriminated union for drill-down context (7 widget variants) and the
// response shape returned by the drill_down API action.
// Shared by all widgets, the drill-down panel, and the API layer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Drill-down context — one variant per clickable widget
// ---------------------------------------------------------------------------

export interface SentimentDrillDown {
  type: "sentiment";
  value: "positive" | "negative" | "neutral" | "mixed";
}

export interface UrgencyDrillDown {
  type: "urgency";
  value: "low" | "medium" | "high" | "critical";
}

export interface ClientDrillDown {
  type: "client";
  clientId: string;
  clientName: string;
}

export interface CompetitorDrillDown {
  type: "competitor";
  competitor: string;
}

export interface ThemeDrillDown {
  type: "theme";
  themeId: string;
  themeName: string;
}

export interface ThemeBucketDrillDown {
  type: "theme_bucket";
  themeId: string;
  themeName: string;
  bucket: string;
}

export interface ThemeClientDrillDown {
  type: "theme_client";
  themeId: string;
  themeName: string;
  clientId: string;
  clientName: string;
}

export type DrillDownContext =
  | SentimentDrillDown
  | UrgencyDrillDown
  | ClientDrillDown
  | CompetitorDrillDown
  | ThemeDrillDown
  | ThemeBucketDrillDown
  | ThemeClientDrillDown;

// ---------------------------------------------------------------------------
// Drill-down API response shape
// ---------------------------------------------------------------------------

export interface DrillDownSignal {
  embeddingId: string;
  sessionId: string;
  sessionDate: string;
  chunkText: string;
  chunkType: string;
  themeName: string | null;
  metadata: Record<string, unknown>;
}

export interface DrillDownClientGroup {
  clientId: string;
  clientName: string;
  signalCount: number;
  signals: DrillDownSignal[];
}

export interface DrillDownResult {
  filterLabel: string;
  totalSignals: number;
  totalClients: number;
  clients: DrillDownClientGroup[];
}
