// ---------------------------------------------------------------------------
// Theme Repository Interface
// ---------------------------------------------------------------------------

import type { Theme } from "@/lib/types/theme";

export interface ThemeInsert {
  name: string;
  description: string | null;
  team_id: string | null;
  initiated_by: string;
  origin: "ai" | "user";
  /**
   * Embedding of name + description (PRD-026 P1.R1). Always supplied —
   * either the prevention guard's precomputed vector during extraction, or
   * the backfill script's vector for one-shot population. The DB column is
   * NOT NULL after migration 002.
   */
  embedding: number[];
}

export interface ThemeUpdate {
  name?: string;
  description?: string | null;
  is_archived?: boolean;
  /** Used by the backfill path and any future "rename theme regenerates embedding" flow. */
  embedding?: number[];
}

export interface ThemeRepository {
  /** Fetch all active (non-archived) themes for a workspace, including embeddings. */
  getActiveByWorkspace(teamId: string | null, userId: string): Promise<Theme[]>;

  /** Get a single theme by ID. */
  getById(id: string): Promise<Theme | null>;

  /** Find a theme by name (case-insensitive) within a workspace. */
  findByName(name: string, teamId: string | null, userId: string): Promise<Theme | null>;

  /** Create a new theme. Returns the created theme. */
  create(data: ThemeInsert): Promise<Theme>;

  /** Update a theme. */
  update(id: string, data: ThemeUpdate): Promise<Theme>;

  /**
   * Backfill consumer — fetches every theme (across all workspaces) whose
   * embedding column is NULL. Service-role only; not workspace-scoped.
   *
   * Returns a minimal projection (id + name + description) rather than full
   * Theme rows: the embedding column is null by definition for these rows,
   * which would violate the tightened Theme.embedding: number[] invariant.
   */
  listMissingEmbeddings(): Promise<Pick<Theme, "id" | "name" | "description">[]>;

  /**
   * Backfill writer — sets the embedding on an existing theme. Distinct from
   * update() so the operational intent is explicit at the call site.
   */
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
}
