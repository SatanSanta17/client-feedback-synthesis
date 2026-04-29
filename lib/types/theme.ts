// ---------------------------------------------------------------------------
// Theme Types
// ---------------------------------------------------------------------------

export interface Theme {
  id: string;
  name: string;
  description: string | null;
  teamId: string | null;
  initiatedBy: string;
  origin: "ai" | "user";
  isArchived: boolean;
  /**
   * Embedding of the theme's name + description used by the prevention guard
   * (PRD-026 Part 1) and Part 2's candidate generation. Guaranteed non-null
   * after migration 002 — the DB rejects null inserts and the backfill has
   * populated every pre-existing row.
   */
  embedding: number[];
  /**
   * Forward-compat for PRD-026 Part 3 — pointer from an archived theme to
   * the canonical theme it merged into. Always null in Part 1.
   */
  mergedIntoThemeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignalTheme {
  id: string;
  embeddingId: string;
  themeId: string;
  assignedBy: "ai" | "user";
  confidence: number | null;
  createdAt: string;
}

/** Shape of a single signal's theme assignment as returned by the LLM. */
export interface LLMThemeAssignment {
  signalIndex: number;
  themes: Array<{
    themeName: string;
    isNew: boolean;
    confidence: number;
    description?: string; // LLM-generated description for new themes only
  }>;
}

/** Result returned by assignSessionThemes() for logging/verification. */
export interface ThemeAssignmentResult {
  totalSignals: number;
  totalAssignments: number;
  newThemesCreated: number;
  existingThemesUsed: number;
}
