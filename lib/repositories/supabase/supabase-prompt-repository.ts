import { type SupabaseClient } from "@supabase/supabase-js";

import type { PromptRepository } from "../prompt-repository";

export function createPromptRepository(
  supabase: SupabaseClient,
  _teamId: string | null
): PromptRepository {
  return {
    async getActive(_promptKey) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getHistory(_promptKey) {
      void supabase;
      throw new Error("Not implemented");
    },
    async deactivateCurrent(_promptKey) {
      void supabase;
      throw new Error("Not implemented");
    },
    async create(_input) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
