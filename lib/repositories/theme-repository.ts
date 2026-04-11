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
}

export interface ThemeUpdate {
  name?: string;
  description?: string | null;
  is_archived?: boolean;
}

export interface ThemeRepository {
  /** Fetch all active (non-archived) themes for a workspace. */
  getActiveByWorkspace(teamId: string | null, userId: string): Promise<Theme[]>;

  /** Get a single theme by ID. */
  getById(id: string): Promise<Theme | null>;

  /** Find a theme by name (case-insensitive) within a workspace. */
  findByName(name: string, teamId: string | null, userId: string): Promise<Theme | null>;

  /** Create a new theme. Returns the created theme. */
  create(data: ThemeInsert): Promise<Theme>;

  /** Update a theme. */
  update(id: string, data: ThemeUpdate): Promise<Theme>;
}
