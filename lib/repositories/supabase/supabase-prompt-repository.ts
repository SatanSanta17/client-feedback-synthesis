import { type SupabaseClient } from "@supabase/supabase-js";

import type { PromptRepository, PromptKey, PromptVersionRow } from "../prompt-repository";

export function createPromptRepository(
  supabase: SupabaseClient,
  teamId: string | null
): PromptRepository {
  return {
    async getActive(promptKey: PromptKey): Promise<string | null> {
      console.log("[supabase-prompt-repo] getActive — key:", promptKey, "teamId:", teamId);

      let query = supabase
        .from("prompt_versions")
        .select("content")
        .eq("prompt_key", promptKey)
        .eq("is_active", true);

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error(
          `[supabase-prompt-repo] getActive error for ${promptKey}:`,
          error.message
        );
        return null;
      }

      return data?.content ?? null;
    },

    async getHistory(promptKey: PromptKey): Promise<PromptVersionRow[]> {
      console.log("[supabase-prompt-repo] getHistory — key:", promptKey, "teamId:", teamId);

      let query = supabase
        .from("prompt_versions")
        .select("*")
        .eq("prompt_key", promptKey)
        .order("created_at", { ascending: false });

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      const { data, error } = await query;

      if (error) {
        console.error(
          `[supabase-prompt-repo] getHistory error for ${promptKey}:`,
          error.message
        );
        return [];
      }

      return data ?? [];
    },

    async deactivateCurrent(promptKey: PromptKey): Promise<void> {
      console.log("[supabase-prompt-repo] deactivateCurrent — key:", promptKey, "teamId:", teamId);

      let query = supabase
        .from("prompt_versions")
        .update({ is_active: false })
        .eq("prompt_key", promptKey)
        .eq("is_active", true);

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      const { error } = await query;

      if (error) {
        console.error(
          `[supabase-prompt-repo] deactivateCurrent error for ${promptKey}:`,
          error.message
        );
        throw new Error(`Failed to deactivate current prompt: ${error.message}`);
      }
    },

    async create(input): Promise<PromptVersionRow> {
      console.log("[supabase-prompt-repo] create — key:", input.promptKey, "teamId:", teamId);

      const { data, error } = await supabase
        .from("prompt_versions")
        .insert({
          prompt_key: input.promptKey,
          content: input.content,
          author_id: input.authorId,
          author_email: input.authorEmail,
          is_active: true,
          team_id: teamId,
        })
        .select()
        .single();

      if (error) {
        console.error(
          `[supabase-prompt-repo] create error for ${input.promptKey}:`,
          error.message
        );
        throw new Error(`Failed to save prompt version: ${error.message}`);
      }

      console.log("[supabase-prompt-repo] create success:", data.id);
      return data;
    },
  };
}
