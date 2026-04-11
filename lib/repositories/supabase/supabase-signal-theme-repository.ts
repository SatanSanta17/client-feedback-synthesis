import { type SupabaseClient } from "@supabase/supabase-js";

import type { SignalTheme } from "@/lib/types/theme";
import type {
  SignalThemeRepository,
  SignalThemeInsert,
} from "../signal-theme-repository";

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface SignalThemeRow {
  id: string;
  embedding_id: string;
  theme_id: string;
  assigned_by: string;
  confidence: number | null;
  created_at: string;
}

function mapRow(row: SignalThemeRow): SignalTheme {
  return {
    id: row.id,
    embeddingId: row.embedding_id,
    themeId: row.theme_id,
    assignedBy: row.assigned_by as "ai" | "user",
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory for creating a Supabase-backed SignalThemeRepository.
 *
 * Uses the service-role client for write operations (signal-theme assignment
 * runs in a fire-and-forget server context after embedding generation).
 *
 * @param serviceClient - Service-role client (bypasses RLS for writes)
 */
export function createSignalThemeRepository(
  serviceClient: SupabaseClient
): SignalThemeRepository {
  return {
    async bulkCreate(data: SignalThemeInsert[]): Promise<void> {
      if (data.length === 0) {
        return;
      }

      console.log(
        `[supabase-signal-theme-repo] bulkCreate — ${data.length} assignments`
      );

      const { error } = await serviceClient
        .from("signal_themes")
        .insert(data);

      if (error) {
        console.error(
          `[supabase-signal-theme-repo] bulkCreate — error:`,
          error.message
        );
        throw new Error(
          `Failed to insert signal theme assignments: ${error.message}`
        );
      }

      console.log(
        `[supabase-signal-theme-repo] bulkCreate — success, ${data.length} assignments inserted`
      );
    },

    async getByEmbeddingIds(embeddingIds: string[]): Promise<SignalTheme[]> {
      if (embeddingIds.length === 0) {
        return [];
      }

      console.log(
        `[supabase-signal-theme-repo] getByEmbeddingIds — ${embeddingIds.length} IDs`
      );

      const { data, error } = await serviceClient
        .from("signal_themes")
        .select("*")
        .in("embedding_id", embeddingIds);

      if (error) {
        console.error(
          "[supabase-signal-theme-repo] getByEmbeddingIds — error:",
          error.message
        );
        throw new Error(
          `Failed to fetch signal themes by embedding IDs: ${error.message}`
        );
      }

      console.log(
        `[supabase-signal-theme-repo] getByEmbeddingIds — returning ${data?.length ?? 0} assignments`
      );

      return (data ?? []).map(mapRow);
    },

    async getByThemeId(themeId: string): Promise<SignalTheme[]> {
      console.log(
        `[supabase-signal-theme-repo] getByThemeId — themeId: ${themeId}`
      );

      const { data, error } = await serviceClient
        .from("signal_themes")
        .select("*")
        .eq("theme_id", themeId);

      if (error) {
        console.error(
          `[supabase-signal-theme-repo] getByThemeId — error for theme ${themeId}:`,
          error.message
        );
        throw new Error(
          `Failed to fetch signal themes by theme ID: ${error.message}`
        );
      }

      console.log(
        `[supabase-signal-theme-repo] getByThemeId — returning ${data?.length ?? 0} assignments`
      );

      return (data ?? []).map(mapRow);
    },
  };
}
