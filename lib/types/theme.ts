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
