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
  embedding: string | number[] | null;
  merged_into_theme_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * pgvector columns come back from PostgREST as a JSON-array-shaped string
 * (e.g., "[0.1,0.2,...]"). Parses to number[]. Throws on null — post-rollout
 * the DB column is NOT NULL, so a null here means either the column hasn't
 * been migrated, the backfill hasn't run, or migration 002 hasn't applied.
 * Surfacing this loudly is better than silently returning a partial row.
 */
function parseEmbedding(raw: string | number[] | null, themeId: string): number[] {
  if (raw === null) {
    throw new Error(
      `[supabase-theme-repo] theme ${themeId} has NULL embedding — run backfill + migration 002`
    );
  }
  if (Array.isArray(raw)) return raw;
  return JSON.parse(raw) as number[];
}

/**
 * pgvector inserts/updates accept the same JSON-array-shaped string. Centralised
 * so every write path produces the identical wire format.
 */
function serialiseEmbedding(vec: number[]): string {
  return `[${vec.join(",")}]`;
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
    embedding: parseEmbedding(row.embedding, row.id),
    mergedIntoThemeId: row.merged_into_theme_id,
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
        `[supabase-theme-repo] create — name: "${input.name}", teamId: ${teamId}, origin: ${input.origin}, embedding: ${input.embedding ? "present" : "null"}`
      );

      const { data, error } = await serviceClient
        .from("themes")
        .insert({
          name: input.name,
          description: input.description,
          team_id: input.team_id,
          initiated_by: input.initiated_by,
          origin: input.origin,
          embedding: input.embedding ? serialiseEmbedding(input.embedding) : null,
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

      const payload: Record<string, unknown> = { ...input };
      if (input.embedding !== undefined) {
        payload.embedding = serialiseEmbedding(input.embedding);
      }

      const { data, error } = await serviceClient
        .from("themes")
        .update(payload)
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

    async listMissingEmbeddings(): Promise<
      Pick<Theme, "id" | "name" | "description">[]
    > {
      console.log("[supabase-theme-repo] listMissingEmbeddings — fetching themes with NULL embedding");

      // Minimal projection — these rows have null embeddings by definition
      // and cannot satisfy the full Theme contract. Backfill only needs id,
      // name, description to compose the embedding text.
      const { data, error } = await serviceClient
        .from("themes")
        .select("id, name, description")
        .is("embedding", null)
        .order("created_at", { ascending: true });

      if (error) {
        console.error(
          "[supabase-theme-repo] listMissingEmbeddings — error:",
          error.message
        );
        throw new Error(`Failed to list themes with missing embeddings: ${error.message}`);
      }

      console.log(
        `[supabase-theme-repo] listMissingEmbeddings — returning ${data?.length ?? 0} themes`
      );

      return data ?? [];
    },

    async updateEmbedding(id: string, embedding: number[]): Promise<void> {
      console.log(
        `[supabase-theme-repo] updateEmbedding — id: ${id}, dimensions: ${embedding.length}`
      );

      const { error } = await serviceClient
        .from("themes")
        .update({ embedding: serialiseEmbedding(embedding) })
        .eq("id", id);

      if (error) {
        console.error(
          `[supabase-theme-repo] updateEmbedding — error for id ${id}:`,
          error.message
        );
        throw new Error(`Failed to update theme embedding: ${error.message}`);
      }

      console.log(`[supabase-theme-repo] updateEmbedding — success for id: ${id}`);
    },
  };
}
