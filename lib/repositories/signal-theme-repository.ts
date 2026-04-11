// ---------------------------------------------------------------------------
// Signal Theme Repository Interface
// ---------------------------------------------------------------------------

import type { SignalTheme } from "@/lib/types/theme";

export interface SignalThemeInsert {
  embedding_id: string;
  theme_id: string;
  assigned_by: "ai" | "user";
  confidence: number | null;
}

export interface SignalThemeRepository {
  /** Bulk insert signal-theme assignments. */
  bulkCreate(data: SignalThemeInsert[]): Promise<void>;

  /** Get all theme assignments for a list of embedding IDs. */
  getByEmbeddingIds(embeddingIds: string[]): Promise<SignalTheme[]>;

  /** Get all theme assignments for a theme. */
  getByThemeId(themeId: string): Promise<SignalTheme[]>;
}
