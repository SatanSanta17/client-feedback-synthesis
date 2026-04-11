import { type SupabaseClient } from "@supabase/supabase-js";

import type { Theme } from "@/lib/types/theme";
import type { ThemeRepository, ThemeInsert, ThemeUpdate } from "../theme-repository";
import { scopeByTeam } from "./scope-by-team";

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface ThemeRow {
  id: string;
  name: string;
  description: string | null;
  team_id: string | null;
  initiated_by: string;
  origin: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ThemeRow): Theme {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    teamId: row.team_id,
    initiatedBy: row.initiated_by,
    origin: row.origin as "ai" | "user",
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory for creating a Supabase-backed ThemeRepository.
 *
 * Uses the service-role client for write operations (theme creation during
 * extraction runs in a fire-and-forget server context). Reads use workspace
 * scoping via scopeByTeam().
 *
 * @param serviceClient - Service-role client (bypasses RLS for writes)
 * @param teamId        - Active workspace scope (null = personal)
 */
export function createThemeRepository(
  serviceClient: SupabaseClient,
  teamId: string | null
): ThemeRepository {
  return {
    async getActiveByWorkspace(
      _teamId: string | null,
      userId: string
    ): Promise<Theme[]> {
      console.log(
        `[supabase-theme-repo] getActiveByWorkspace — teamId: ${teamId}, userId: ${userId}`
      );

      let query = serviceClient
        .from("themes")
        .select("*")
        .eq("is_archived", false)
        .order("name", { ascending: true });

      query = scopeByTeam(query, teamId);

      // For personal workspace, also filter by initiated_by
      if (!teamId) {
        query = query.eq("initiated_by", userId);
      }

      const { data, error } = await query;

      if (error) {
        console.error(
          "[supabase-theme-repo] getActiveByWorkspace — error:",
          error.message
        );
        throw new Error(`Failed to fetch active themes: ${error.message}`);
      }

      console.log(
        `[supabase-theme-repo] getActiveByWorkspace — returning ${data?.length ?? 0} themes`
      );

      return (data ?? []).map(mapRow);
    },

    async getById(id: string): Promise<Theme | null> {
      console.log(`[supabase-theme-repo] getById — id: ${id}`);

      const { data, error } = await serviceClient
        .from("themes")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error(
          `[supabase-theme-repo] getById — error for id ${id}:`,
          error.message
        );
        throw new Error(`Failed to fetch theme: ${error.message}`);
      }

      return data ? mapRow(data) : null;
    },

    async findByName(
      name: string,
      _teamId: string | null,
      userId: string
    ): Promise<Theme | null> {
      console.log(
        `[supabase-theme-repo] findByName — name: "${name}", teamId: ${teamId}`
      );

      let query = serviceClient
        .from("themes")
        .select("*")
        .ilike("name", name)
        .eq("is_archived", false);

      query = scopeByTeam(query, teamId);

      // For personal workspace, also filter by initiated_by
      if (!teamId) {
        query = query.eq("initiated_by", userId);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error(
          `[supabase-theme-repo] findByName — error for "${name}":`,
          error.message
        );
        throw new Error(`Failed to find theme by name: ${error.message}`);
      }

      return data ? mapRow(data) : null;
    },

    async create(input: ThemeInsert): Promise<Theme> {
      console.log(
        `[supabase-theme-repo] create — name: "${input.name}", teamId: ${teamId}, origin: ${input.origin}`
      );

      const { data, error } = await serviceClient
        .from("themes")
        .insert({
          name: input.name,
          description: input.description,
          team_id: input.team_id,
          initiated_by: input.initiated_by,
          origin: input.origin,
        })
        .select("*")
        .single();

      if (error) {
        console.error(
          `[supabase-theme-repo] create — error for "${input.name}":`,
          error.message
        );
        throw new Error(`Failed to create theme: ${error.message}`);
      }

      console.log(
        `[supabase-theme-repo] create — success, id: ${data.id}`
      );

      return mapRow(data);
    },

    async update(id: string, input: ThemeUpdate): Promise<Theme> {
      console.log(
        `[supabase-theme-repo] update — id: ${id}, fields: ${Object.keys(input).join(", ")}`
      );

      const { data, error } = await serviceClient
        .from("themes")
        .update(input)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        console.error(
          `[supabase-theme-repo] update — error for id ${id}:`,
          error.message
        );
        throw new Error(`Failed to update theme: ${error.message}`);
      }

      console.log(`[supabase-theme-repo] update — success for id: ${id}`);

      return mapRow(data);
    },
  };
}
